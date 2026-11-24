use bun_dns_client::{Family, Transport, Variable};

use crate::machine::{HOSTS, NOTHING, NSSWITCH, RESOLV_CONF, Setup, resolv_conf};
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
