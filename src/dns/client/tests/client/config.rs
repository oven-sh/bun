use bun_dns_client::{Family, RecordType, Transport, Variable};

use crate::machine::{
    HOSTS, NOTHING, NSSWITCH, RESOLV_CONF, Sent, Setup, Test, resolv_conf, two_servers,
};
use crate::wire::*;

fn servers(text: impl AsRef<[u8]>) -> String {
    resolv_conf(text).start().servers().join(" ")
}

/// The names that a lookup of `host` asks for if none exists.
pub(crate) fn searched(setup: Setup, host: &str) -> String {
    let mut test = setup.start();
    let (mut answers, mut asked) = (test.lookup(host, Family::Inet), Vec::new());
    while answers.is_empty() {
        let query = test.sent_one();
        asked.push(query.question().strip_suffix(" A").unwrap().to_owned());
        answers = test.decline(&query, NXDOMAIN);
    }
    asked.join(" ")
}

fn search_list(text: impl AsRef<[u8]>) -> String {
    searched(resolv_conf(text), "h")
}

/// Where a lookup looks: `d` for DNS and `f` for the hosts file.
fn sources(setup: Setup) -> String {
    let mut test = setup.file(HOSTS, "").start();
    let (mut order, answers) = (String::new(), test.lookup("a.test", Family::Inet));
    let reads = test.world().hosts_reads;
    order.extend((reads > 0).then_some('f'));
    if answers.is_empty() {
        test.decline(&test.sent_one(), NXDOMAIN);
        order.push('d');
        order.extend((test.world().hosts_reads > reads).then_some('f'));
    }
    order
}

fn first_timeout(setup: Setup) -> u64 {
    let mut test = setup.start();
    test.ask("a.test");
    test.wait_for_timeout()
}

const DEFAULT: &str = "127.0.0.1:53";

#[test]
fn defaults() {
    assert_eq!(Setup::default().start().servers(), [DEFAULT]);
    assert_eq!(searched(Setup::default(), "h"), "h");
    assert_eq!(sources(Setup::default()), "fd");
    assert_eq!(first_timeout(Setup::default()), 2000);
}

#[test]
fn files_that_cannot_be_read() {
    let mut setup = resolv_conf("nameserver 1.1.1.1").file(NSSWITCH, "");
    setup.world.files.get_mut(NSSWITCH.as_bytes()).unwrap().0 = None;
    assert_eq!(setup.start().servers(), ["1.1.1.1:53"]);

    let mut setup = resolv_conf("").file(NSSWITCH, "hosts: dns");
    setup.world.files.get_mut(RESOLV_CONF.as_bytes()).unwrap().0 = None;
    assert_eq!(sources(setup), "d");
}

#[test]
fn nameserver() {
    for (value, expected) in [
        ("1.2.3.4", "1.2.3.4:53"),
        ("1.2.3.4:54", "1.2.3.4:54"),
        ("1.2.3.4:0", "1.2.3.4:53"),
        ("[1.2.3.4]", "1.2.3.4:53"),
        ("[1.2.3.4]:65535", "1.2.3.4:65535"),
        ("1::2", "[1::2]:53"),
        ("1::2:54", "[1::2:54]:53"),
        ("[1::2]", "[1::2]:53"),
        ("[1::2]:54", "[1::2]:54"),
        ("fe80::1%eth0", "[fe80::1%7]:53"),
        ("fe80::1%9", "[fe80::1%9]:53"),
        ("[fe80::1]:54%eth0", "[fe80::1%7]:54"),
        ("1::2%eth0", "[1::2]:53"),
        ("1.2.3.4%nothing", "1.2.3.4:53"),
        ("ff00::1", "[ff00::1]:53"),
        (
            "1.1.1.1 2.2.2.2,3.3.3.3\t1.1.1.1\r",
            "1.1.1.1:53 2.2.2.2:53 3.3.3.3:53",
        ),
        ("x 1.1.1.1", "1.1.1.1:53"),
    ] {
        assert_eq!(servers(format!("nameserver {value}")), expected, "{value}");
    }
    for value in [
        "",
        "x",
        "1.2.3",
        "1.2.3.4.5",
        "1.2.3.04",
        "1.2.3.4/8",
        "1.2.3.4:",
        "1.2.3.4:x",
        "1.2.3.4:+1",
        "1.2.3.4:65536",
        "x:53",
        "[",
        "[1::2",
        "[1::2]x",
        "[1::2]:",
        "[x]:53",
        "fe80::1",
        "fe80::1%",
        "fe80::1%0",
        "fe80::1%nothing",
        "febf::1",
        "fec0::1",
        "feff::1%eth0",
    ] {
        assert_eq!(servers(format!("nameserver {value}")), DEFAULT, "{value}");
    }
}

#[test]
fn lines() {
    let text = b"# nameserver 1.1.1.1\n; nameserver 2.2.2.2\n\n\0\xff\nunknown 3.3.3.3\n\
        \t nameserver\t4.4.4.4 # 5.5.5.5\r\nnameserver 6.6.6.6;7.7.7.7\nnameserver8.8.8.8\n\
        Nameserver 9.9.9.9\nnameserver";
    assert_eq!(servers(text), "4.4.4.4:53 6.6.6.6:53");
}

#[test]
fn search() {
    for (text, expected) in [
        ("search a b.c", "h.a h.b.c h"),
        ("search\ta,b\tA , B.", "h.a h.b h.B h"),
        ("search a\rb\x0bc\x0cd", "h.a h.b h.c h.d h"),
        ("search a\nsearch b", "h.b h"),
        ("search a\nsearch\nsearch ,\nsearch !", "h.a h"),
        ("search a! .b c..d é e", "h.b h.e h"),
        ("search . a", "h h.a h"),
        ("domain a b", "h.a h"),
        ("domain a\nsearch b c", "h.b h.c h"),
        ("search b c\ndomain a", "h.b h.c h"),
    ] {
        assert_eq!(search_list(text), expected, "{text}");
    }
    let many: Vec<_> = (0..200).map(|index| format!("d{index}")).collect();
    let expected = format!("h.{} h", many.join(" h."));
    assert_eq!(search_list(format!("search {}", many.join(" "))), expected);
}

#[test]
fn domain_of_this_machine() {
    for (text, hostname, expected) in [
        ("", "me.a.b", "h.a.b h"),
        ("", "me", "h"),
        ("", "me.", "h"),
        ("search c", "me.a.b", "h.c h"),
    ] {
        let mut setup = resolv_conf(text);
        setup.world.hostname = Some(hostname);
        assert_eq!(searched(setup, "h"), expected);
    }
}

#[test]
fn ndots() {
    let searched = |options: &str| {
        let text = format!("search s\noptions {options}");
        ["h", "h.i"].map(|host| searched(resolv_conf(&text), host))
    };
    assert_eq!(searched("ndots:0"), ["h h.s", "h.i h.i.s"]);
    assert_eq!(searched("ndots:2"), ["h.s h", "h.i.s h.i"]);
    for space in [' ', '\t', '\r', '\x0b', '\x0c'] {
        let options = format!("ndots:0 x{space}ndots:2");
        assert_eq!(searched(&options), ["h.s h", "h.i.s h.i"]);
    }
    for ignored in [
        "",
        "ndots",
        "ndots:",
        "ndots:x",
        "ndots:-1",
        "ndots:4294967296",
        "x:2",
    ] {
        assert_eq!(searched(ignored), ["h.s h", "h.i h.i.s"]);
    }
}

#[test]
fn timeout() {
    for (option, expected) in [
        ("timeout:1", 1000),
        ("retrans:3", 3000),
        ("timeout:30", 30000),
        ("timeout:31", 30000),
        ("timeout:4294967295", 30000),
        ("timeout:0", 2000),
        ("timeout", 2000),
    ] {
        let mut test = resolv_conf(format!("options {option}")).tries(1).start();
        test.ask("a.test");
        assert_eq!((1..).find(|_| !test.wait(1).is_empty()), Some(expected));
    }
}

#[test]
fn use_vc() {
    for option in ["use-vc", "usevc"] {
        let mut test = resolv_conf(format!("options {option}")).start();
        let query = test.ask("a.test");
        assert_eq!(test.transport_of(&query), Transport::Tcp);
    }
}

#[test]
fn order_of_sources() {
    for (text, expected) in [
        ("hosts: files", "f"),
        ("hosts:dns dns", "d"),
        (" hosts\t:\tDNS [NOTFOUND=return] mdns Files dns", "df"),
        ("hosts: resolve [!UNAVAIL=return] dns files", "fd"),
        ("hosts: resolve", "fd"),
        ("hosts: files # dns", "fd"),
        ("hosts: dns\nhosts: files\nhosts: ldap", "f"),
        ("# hosts: dns\nnetworks: dns\nhosts dns\nhosts:", "fd"),
    ] {
        assert_eq!(
            sources(Setup::default().file(NSSWITCH, text)),
            expected,
            "{text}"
        );
    }
}

#[test]
fn environment() {
    let with = |variable, value| {
        let mut setup = resolv_conf("nameserver 1.1.1.1\nsearch a b\noptions timeout:3");
        setup.variables.push((variable, value));
        setup
    };
    for domains in ["c d", "c\nd"] {
        assert_eq!(searched(with(Variable::LocalDomain, domains), "h"), "h.c h");
    }
    for options in ["ndots:0", "x\nndots:0"] {
        assert_eq!(
            searched(with(Variable::ResOptions, options), "h"),
            "h h.a h.b"
        );
    }
    assert_eq!(first_timeout(with(Variable::ResOptions, "timeout:4")), 4000);
    for variable in [Variable::LocalDomain, Variable::ResOptions] {
        for nothing in ["", " "] {
            assert_eq!(searched(with(variable, nothing), "h"), "h.a h.b h");
            assert_eq!(with(variable, nothing).start().servers(), ["1.1.1.1:53"]);
        }
    }
}

#[test]
fn read_once() {
    let mut test = resolv_conf("nameserver 1.1.1.1").start();
    test.world().write(RESOLV_CONF, "nameserver 2.2.2.2");
    assert_eq!(test.lookup("a.test", Family::Inet), NOTHING);
    assert_eq!(test.server_of(&test.sent_one()), "1.1.1.1:53");
}

/// Each kind of request, and its answer if the only server refuses its one try.
const REQUESTS: [(fn(&mut Test) -> Vec<String>, &str); 4] = [
    (|test| test.resolve(RecordType::A, "a.test"), "ECONNREFUSED"),
    (|test| test.lookup("a.test", Family::Inet), "ECONNREFUSED"),
    (|test| test.reverse("10.9.9.9"), "ENOTFOUND"),
    (|test| test.name_info("10.9.9.9", 80), "ENOTFOUND"),
];

/// The socket of the one query that is out fails.
fn refuse(test: &mut Test) -> Vec<String> {
    let socket = test.sent_one().socket;
    test.process_error(socket)
}

/// With one try for each query, and a name that the only server has refused.
fn after_a_refusal(setup: Setup) -> Test {
    let mut test = setup.tries(1).start();
    test.resolve(RecordType::A, "refused.test");
    assert_eq!(refuse(&mut test), ["ECONNREFUSED"]);
    test
}

/// How often the configuration has been read once the first server has refused and one more name was asked for.
fn reads_after_a_refusal(mut test: Test) -> usize {
    test.resolve(RecordType::A, "refused.test");
    refuse(&mut test);
    test.resolve(RecordType::A, "next.test");
    test.world().resolv_conf_reads
}

fn questions(sent: &[Sent]) -> Vec<String> {
    sent.iter().map(Sent::question).collect()
}

#[test]
fn read_again_after_the_stand_in_refused() {
    for options in ["", "options use-vc"] {
        for (request, refusal) in REQUESTS {
            let mut test = resolv_conf(options).tries(1).start();
            assert_eq!(test.servers(), [DEFAULT]);
            assert_eq!(request(&mut test), NOTHING);
            assert_eq!(refuse(&mut test), [refusal]);
            assert_eq!(test.world().resolv_conf_reads, 1);

            test.world().write(RESOLV_CONF, "nameserver 10.0.0.1");
            assert_eq!(request(&mut test), NOTHING);
            let query = test.sent_one();
            assert_eq!(test.server_of(&query), "10.0.0.1:53");
            assert_eq!(test.transport_of(&query), Transport::Udp);
            assert_eq!(test.servers(), ["10.0.0.1:53"]);
            assert_eq!(test.world().resolv_conf_reads, 2);
        }
    }
}

#[test]
fn read_again_after_no_socket_was_left() {
    let mut setup = resolv_conf("nameserver 10.0.0.1").tries(1);
    setup.world.files.get_mut(RESOLV_CONF.as_bytes()).unwrap().0 = None;
    setup.world.socket_limit = Some(0);
    let mut test = setup.start();
    assert_eq!(test.servers(), [DEFAULT]);
    assert_eq!(test.resolve(RecordType::A, "a.test"), ["ECONNREFUSED"]);
    assert_eq!(test.resolve(RecordType::A, "b.test"), ["2: ECONNREFUSED"]);
    assert_eq!(test.world().resolv_conf_reads, 2);

    test.world().socket_limit = None;
    test.world().write(RESOLV_CONF, "nameserver 10.0.0.1");
    let query = test.ask("c.test");
    assert_eq!(test.server_of(&query), "10.0.0.1:53");
    assert_eq!(test.world().resolv_conf_reads, 3);
}

#[test]
fn one_refusal_is_one_more_read() {
    let mut test = after_a_refusal(resolv_conf(""));
    let [b, c] = ["b.test", "c.test"].map(|name| test.ask(name));
    assert_eq!(test.world().resolv_conf_reads, 2);
    assert_eq!(test.servers(), [DEFAULT]);
    assert_eq!(
        (test.server_of(&b), b.socket, c.socket),
        (DEFAULT.into(), 1, 1)
    );
    assert_eq!(
        test.process_error(1),
        ["2: ECONNREFUSED", "3: ECONNREFUSED"]
    );
    test.ask_many("test", 100);
    assert_eq!(test.world().resolv_conf_reads, 3);
}

#[test]
fn request_that_needs_no_server_does_not_read() {
    let mut test = after_a_refusal(resolv_conf(""));
    assert_eq!(test.lookup("10.0.0.7", Family::Inet), ["2: 10.0.0.7/0"]);
    assert_eq!(test.lookup("a.onion", Family::Inet), ["3: ENOTFOUND"]);
    assert_eq!(test.world().resolv_conf_reads, 1);

    test.world().write(RESOLV_CONF, "nameserver 10.0.0.1");
    let query = test.ask("b.test");
    assert_eq!(test.server_of(&query), "10.0.0.1:53");
    assert_eq!(test.world().resolv_conf_reads, 2);
}

#[test]
fn cached_name_does_not_spend_the_read() {
    let mut test = resolv_conf("").tries(1).start();
    let cached = test.ask("cached.test");
    assert_eq!(
        test.answer(&cached, &[address("1.1.1.1", 60)]),
        ["1.1.1.1/60"]
    );
    test.resolve(RecordType::A, "refused.test");
    assert_eq!(refuse(&mut test), ["2: ECONNREFUSED"]);

    assert_eq!(
        test.resolve(RecordType::A, "cached.test"),
        ["3: 1.1.1.1/60"]
    );
    assert_eq!(test.world().resolv_conf_reads, 1);
    test.world().write(RESOLV_CONF, "nameserver 10.0.0.1");
    let query = test.ask("new.test");
    assert_eq!(test.server_of(&query), "10.0.0.1:53");
}

#[test]
fn lists_that_are_read_again() {
    for text in ["", "search s", "nameserver fe80::1", "nameserver x"] {
        assert_eq!(
            reads_after_a_refusal(resolv_conf(text).start()),
            2,
            "{text}"
        );
    }
}

/// Node.js also reads again for the first four.
#[test]
fn lists_that_are_final() {
    for text in [
        "nameserver 127.0.0.1",
        "nameserver 127.0.0.1:54",
        "nameserver ::1",
        "nameserver 127.0.0.1\nnameserver 127.0.0.1",
        "nameserver 127.0.0.2",
        "nameserver 10.0.0.1",
        "nameserver 127.0.0.1\nnameserver ::1",
    ] {
        assert_eq!(
            reads_after_a_refusal(resolv_conf(text).start()),
            1,
            "{text}"
        );
    }
    assert_eq!(reads_after_a_refusal(two_servers().start()), 1);

    let mut test = resolv_conf("").start();
    test.set_servers(&["127.0.0.1:53"]);
    assert_eq!(reads_after_a_refusal(test), 1);

    let mut test = after_a_refusal(resolv_conf(""));
    test.set_servers(&["127.0.0.1:53"]);
    test.ask("a.test");
    assert_eq!(test.world().resolv_conf_reads, 1);
}

#[test]
fn timeout_or_answer_leaves_the_list_as_it_is() {
    let mut test = resolv_conf("").tries(1).start();
    test.ask("a.test");
    assert_eq!(test.wait(2000), ["ETIMEOUT"]);
    test.ask("b.test");
    assert_eq!(test.world().resolv_conf_reads, 1);

    let mut test = resolv_conf("").start();
    test.resolve(RecordType::A, "a.test");
    assert_eq!(refuse(&mut test), NOTHING);
    let again = test.sent_one();
    assert_eq!(
        test.answer(&again, &[address("1.1.1.1", 60)]),
        ["1.1.1.1/60"]
    );
    test.ask("b.test");
    assert_eq!(test.world().resolv_conf_reads, 1);
}

#[test]
fn second_read_that_names_no_server_changes_nothing() {
    for unreadable in [true, false] {
        let mut test = after_a_refusal(resolv_conf("search s\noptions ndots:2 use-vc"));
        let file = if unreadable { None } else { Some(Vec::new()) };
        test.world()
            .files
            .get_mut(RESOLV_CONF.as_bytes())
            .unwrap()
            .0 = file;
        assert_eq!(test.lookup("a.b", Family::Inet), NOTHING);
        let query = test.sent_one();
        assert_eq!(query.question(), "a.b.s A");
        assert_eq!(test.transport_of(&query), Transport::Tcp);
        assert_eq!(test.servers(), [DEFAULT]);
        assert_eq!(test.world().resolv_conf_reads, 2);
    }
}

#[test]
fn second_read_keeps_what_still_holds() {
    for (text, server, moves) in [
        ("", DEFAULT, false),
        ("nameserver 127.0.0.1\noptions ndots:0", DEFAULT, false),
        ("nameserver 10.0.0.1", "10.0.0.1:53", true),
    ] {
        let mut test = resolv_conf("").start();
        let cached = test.ask("cached.test");
        test.answer(&cached, &[address("1.1.1.1", 60)]);
        test.resolve(RecordType::A, "a.test");
        assert_eq!(refuse(&mut test), NOTHING);
        assert_eq!(test.server_of(&test.sent_one()), DEFAULT);

        test.world().write(RESOLV_CONF, text);
        assert_eq!(test.resolve(RecordType::A, "b.test"), NOTHING);
        let sent = test.sent();
        let moved: &[&str] = if moves { &["a.test A"] } else { &[] };
        assert_eq!(questions(&sent), [&["b.test A"], moved].concat(), "{text}");
        assert!(sent.iter().all(|it| test.server_of(it) == server));
        let is_cached = !test.resolve(RecordType::A, "cached.test").is_empty();
        assert_eq!(is_cached, !moves, "{text}");
        assert_eq!(test.world().resolv_conf_reads, 2);
    }
}

#[test]
fn second_read_that_names_the_stand_in_is_final() {
    let mut test = after_a_refusal(resolv_conf("search s"));
    test.world()
        .write(RESOLV_CONF, "nameserver 127.0.0.1\nsearch t");
    assert_eq!(test.lookup("a", Family::Inet), NOTHING);
    assert_eq!(test.sent_one().question(), "a.t A");
    assert_eq!(test.process_error(1), ["2: ECONNREFUSED"]);
    test.ask("b.test");
    assert_eq!(test.world().resolv_conf_reads, 2);
}

#[test]
fn second_read_forgets_nothing_about_a_server() {
    let mut test = resolv_conf("").file(HOSTS, "10.1.1.1 listed").start();
    test.resolve(RecordType::A, "refused.test");
    let refusals: Vec<_> = (0..4).flat_map(|_| refuse(&mut test)).collect();
    assert_eq!(refusals, ["ECONNREFUSED"]);
    assert_eq!(test.lookup("listed", Family::Inet), ["2: 10.1.1.1/0"]);
    assert_eq!(test.world().resolv_conf_reads, 2);
    test.set_servers(&["10.0.0.1:53", DEFAULT]);
    let query = test.ask("a.test");
    assert_eq!(test.server_of(&query), "10.0.0.1:53");
    assert_eq!(test.answer(&query, &[ASKED.to_vec()]), NOTHING);
    assert_eq!(test.server_of(&test.sent_one()), "10.0.0.1:53");

    let mut test = resolv_conf("").tries(2).start();
    test.resolve(RecordType::A, "refused.test");
    assert_eq!(refuse(&mut test), NOTHING);
    assert_eq!(refuse(&mut test), ["ECONNREFUSED"]);
    test.world()
        .write(RESOLV_CONF, "nameserver 127.0.0.1\nnameserver 10.0.0.1");
    let query = test.ask("a.test");
    assert_eq!(test.servers(), ["10.0.0.1:53", DEFAULT]);
    assert_eq!(test.server_of(&query), "10.0.0.1:53");
    assert_eq!(test.answer(&query, &[ASKED.to_vec()]), NOTHING);
    assert_eq!(test.server_of(&test.sent_one()), "10.0.0.1:53");
}

#[test]
fn request_that_reads_again_follows_what_it_read() {
    let mut test = after_a_refusal(resolv_conf(""));
    test.world().write(
        RESOLV_CONF,
        "nameserver 10.0.0.1\nsearch s\noptions ndots:2",
    );
    test.world().write(NSSWITCH, "hosts: dns");
    assert_eq!(test.lookup("a.b", Family::Inet), NOTHING);
    assert_eq!(test.sent_one().question(), "a.b.s A");
    assert_eq!(test.world().hosts_reads, 0);

    let names: [fn(&mut Test) -> Vec<String>; 2] = [
        |test| test.reverse("10.9.9.9"),
        |test| test.name_info("10.9.9.9", 80),
    ];
    for request in names {
        let mut test = after_a_refusal(resolv_conf("").file(HOSTS, "10.9.9.9 listed.test"));
        test.world().write(RESOLV_CONF, "nameserver 10.0.0.1");
        test.world().write(NSSWITCH, "hosts: dns");
        assert_eq!(request(&mut test), NOTHING);
        assert_eq!(test.sent_one().question(), "9.9.9.10.in-addr.arpa PTR");
        assert_eq!(test.world().hosts_reads, 0);
    }

    let mut test = after_a_refusal(resolv_conf(""));
    test.world()
        .write(RESOLV_CONF, "nameserver 10.0.0.1\noptions use-vc timeout:3");
    let query = test.ask("a.test");
    assert_eq!(test.transport_of(&query), Transport::Tcp);
    assert_eq!(test.wait_for_timeout(), 3000);
}

#[test]
fn second_read_has_the_same_say_as_the_first() {
    let mut setup = resolv_conf("").timeout(500);
    setup.variables.push((Variable::LocalDomain, "d"));
    setup.variables.push((Variable::ResOptions, "ndots:0"));
    let mut test = after_a_refusal(setup);
    test.client.set_local_ip("10.0.0.9".parse().unwrap());
    test.world().write(
        RESOLV_CONF,
        "nameserver 10.0.0.1\nsearch s\noptions ndots:3 timeout:3",
    );
    assert_eq!(test.lookup("h", Family::Inet), NOTHING);
    let query = test.sent_one();
    assert_eq!(query.question(), "h A");
    assert_eq!(test.server_of(&query), "10.0.0.1:53");
    assert_eq!(
        test.world().opened[query.socket].local,
        "10.0.0.9".parse().ok()
    );
    assert_eq!(test.decline(&query, NXDOMAIN), NOTHING);
    assert_eq!(test.sent_one().question(), "h.d A");
    assert_eq!(test.wait_for_timeout(), 500);
}

#[test]
fn lookup_that_is_out_finishes_its_search_at_the_new_servers() {
    let mut test = resolv_conf("search s").start();
    assert_eq!(test.lookup("a", Family::Inet), NOTHING);
    assert_eq!(refuse(&mut test), NOTHING);
    assert_eq!(test.server_of(&test.sent_one()), DEFAULT);

    test.world()
        .write(RESOLV_CONF, "nameserver 10.0.0.1\nsearch t");
    assert_eq!(test.resolve(RecordType::A, "b.test"), NOTHING);
    let [b, moved] = test.sent_exactly();
    assert_eq!(questions(&[b, moved.clone()]), ["b.test A", "a.s A"]);
    assert_eq!(test.server_of(&moved), "10.0.0.1:53");
    assert_eq!(test.decline(&moved, NXDOMAIN), NOTHING);
    let last = test.sent_one();
    assert_eq!(last.question(), "a A");
    assert_eq!(test.decline(&last, NXDOMAIN), ["ENOTFOUND"]);
    assert_eq!(test.lookup("a", Family::Inet), NOTHING);
    assert_eq!(test.sent_one().question(), "a.t A");
}

#[test]
fn no_read_while_replies_are_taken() {
    let mut test = resolv_conf("search s").start();
    test.ask("other.test");
    test.lookup("a", Family::Inet);
    let query = test.sent_one();
    test.arrive(0, &reply(&query.bytes, NXDOMAIN, [&[], &[], &[]]));
    assert_eq!(test.process_error(0), NOTHING);
    assert_eq!(questions(&test.sent()), ["a A", "other.test A"]);
    assert_eq!(test.world().resolv_conf_reads, 1);
    test.resolve(RecordType::A, "b.test");
    assert_eq!(test.world().resolv_conf_reads, 2);
}
