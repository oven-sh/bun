use bun_dns_client::{Family, RecordType, Transport, Variable};

use crate::machine::{HOSTS, NOTHING, NSSWITCH, RESOLV_CONF, Sent, Setup, Test, resolv_conf};
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
        ("search\ta,b\tA , B.", "h.a h.b h.b h"),
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
        assert_eq!(
            searched(with(Variable::LocalDomain, domains), "h"),
            "h.c h.d h"
        );
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

const OLD: &str = "1.1.1.1:53";
const NEW: &str = "2.2.2.2:53";

/// The machine has moved, and a query is on its way to the old server.
fn moved() -> (Test, Sent) {
    let mut test = resolv_conf("nameserver 1.1.1.1").tries(1).start();
    test.world().write(RESOLV_CONF, "nameserver 2.2.2.2");
    let query = test.ask("a.test");
    (test, query)
}

fn next_server(test: &mut Test) -> String {
    let query = test.ask("next.test");
    test.server_of(&query)
}

#[test]
fn read_again_if_the_servers_were_of_no_use() {
    let (mut test, _) = moved();
    assert_eq!(test.wait(2000), ["ETIMEOUT"]);
    assert_eq!(test.servers(), [OLD]);
    assert_eq!(next_server(&mut test), NEW);

    let (mut test, query) = moved();
    assert_eq!(test.process_error(query.socket), ["ECONNREFUSED"]);
    assert_eq!(next_server(&mut test), NEW);

    for (code, expected) in [(REFUSED, NEW), (SERVFAIL, OLD), (NXDOMAIN, OLD), (0, OLD)] {
        let (mut test, query) = moved();
        test.decline(&query, code);
        assert_eq!(next_server(&mut test), expected);
    }

    let (mut test, query) = moved();
    assert_eq!(test.answer(&query, &[record(A, 1, b"")]), ["EBADRESP"]);
    assert_eq!(next_server(&mut test), OLD);
}

#[test]
fn read_again_for_each_kind_of_request() {
    let requests: [fn(&mut Test) -> Vec<String>; 3] = [
        |test| test.lookup("b.test", Family::Inet),
        |test| test.reverse("3.3.3.3"),
        |test| test.name_info("3.3.3.3", 1),
    ];
    for request in requests {
        let (mut test, query) = moved();
        test.decline(&query, REFUSED);
        assert_eq!(request(&mut test), NOTHING);
        assert_eq!(test.server_of(&test.sent_one()), NEW);
    }
}

#[test]
fn not_read_again() {
    let (mut test, query) = moved();
    let other = test.ask("b.test");
    test.decline(&query, REFUSED);
    test.decline(&other, NXDOMAIN);
    assert_eq!(next_server(&mut test), OLD);

    let (mut test, query) = moved();
    test.set_servers(&[OLD]);
    test.decline(&query, REFUSED);
    assert_eq!(next_server(&mut test), OLD);
}

#[test]
fn guess_does_not_replace_a_server() {
    let (mut test, query) = moved();
    test.world().write(RESOLV_CONF, "");
    test.decline(&query, REFUSED);
    assert_eq!(next_server(&mut test), OLD);
    assert!(!test.client.guesses_server());
}

#[test]
fn not_read_again_too_soon() {
    let (mut test, query) = moved();
    test.decline(&query, REFUSED);
    let query = test.ask("b.test");
    test.world().write(RESOLV_CONF, "nameserver 1.1.1.1");
    test.decline(&query, REFUSED);
    test.wait(4999);
    let query = test.ask("c.test");
    assert_eq!(test.server_of(&query), NEW);
    test.decline(&query, REFUSED);
    test.wait(1);
    assert_eq!(next_server(&mut test), OLD);
}

#[test]
fn all_of_it_is_read_again() {
    let mut test = resolv_conf("search s").timeout(3000).start();
    let text = "search t\noptions use-vc timeout:1";
    test.world().write(RESOLV_CONF, text);
    test.world().write(NSSWITCH, "hosts: dns");
    test.world().write(HOSTS, "1.1.1.1 h");
    let query = test.ask("a.test");
    test.decline(&query, REFUSED);
    assert_eq!(test.lookup("h", Family::Inet), NOTHING);
    let query = test.sent_one();
    assert_eq!(query.question(), "h.t A");
    assert_eq!(test.transport_of(&query), Transport::Tcp);
    assert_eq!(test.wait_for_timeout(), 3000);
}

#[test]
fn what_is_under_way_follows_the_new_list() {
    for (text, follows) in [
        ("nameserver 2.2.2.2", true),
        ("nameserver 2.2.2.2\nnameserver 1.1.1.1", false),
    ] {
        let mut test = resolv_conf("nameserver 1.1.1.1").start();
        let [refused, _] = ["a.test", "b.test"].map(|name| test.ask(name));
        test.world().write(RESOLV_CONF, text);
        test.decline(&refused, REFUSED);
        assert_eq!(test.resolve(RecordType::A, "c.test"), NOTHING);
        let sent = test.sent();
        assert_eq!(sent.len(), 1 + usize::from(follows));
        assert!(sent.iter().all(|it| test.server_of(it) == NEW));
    }
}

#[test]
fn replies_are_kept_unless_the_list_changes() {
    for (text, is_kept) in [
        ("nameserver 1.1.1.1\nnameserver fe80::1%eth0", true),
        ("nameserver fe80::1%7\nnameserver 1.1.1.1", true),
        ("nameserver 1.1.1.1\nnameserver fe80::1%8", false),
        ("nameserver 1.1.1.1", false),
        ("nameserver 1.1.1.1 fe80::1%7 2.2.2.2", false),
    ] {
        let mut test = resolv_conf("nameserver 1.1.1.1\nnameserver fe80::1%eth0").start();
        let [kept, refused] = ["a.test", "b.test"].map(|name| test.ask(name));
        test.answer(&kept, &[address("3.3.3.3", 60)]);
        test.decline(&refused, REFUSED);
        test.world().write(RESOLV_CONF, text);
        let answers = test.resolve(RecordType::A, "a.test");
        assert_eq!(answers.len(), usize::from(is_kept), "{text}");
    }
}

#[test]
fn server_that_is_a_guess() {
    let guesses = |setup: Setup| setup.start().client.guesses_server();
    assert!(guesses(Setup::default()) && guesses(resolv_conf("search s")));
    assert!(!guesses(resolv_conf("nameserver 127.0.0.1")));

    let mut test = Setup::default().start();
    test.set_servers(&[DEFAULT]);
    assert!(!test.client.guesses_server());

    let mut test = Setup::default().start();
    let query = test.ask("a.test");
    test.world().write(RESOLV_CONF, "nameserver 1.1.1.1");
    test.decline(&query, REFUSED);
    test.ask("a.test");
    assert!(!test.client.guesses_server());
}
