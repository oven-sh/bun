use bun_dns_client::{Family, FileStamp};

use crate::machine::{HOSTS, NSSWITCH, Setup, Test};

fn hosts(text: impl AsRef<[u8]>) -> Test {
    let setup = Setup::default().file(NSSWITCH, "hosts: files");
    setup.file(HOSTS, text).start()
}

fn addresses(text: impl AsRef<[u8]>, host: &str) -> String {
    hosts(text).lookup(host, Family::Inet).concat()
}

#[test]
fn syntax() {
    let text = b"# 9.9.9.9 a\n\n\0\xff\n 1.1.1.1\ta  B\r\n2.2.2.2 c # d\n3.3.3.3 e#f g\n4.4.4.4\n\
        5.5.5 h\n5.5.5.05 h\nh 5.5.5.5\n6.6.6.6 \xe9 i! j\n7.7.7.7 k";
    for (host, expected) in [
        ("a", "1.1.1.1/0"),
        ("A", "1.1.1.1/0"),
        ("b", "1.1.1.1/0"),
        ("c", "2.2.2.2/0"),
        ("e", "3.3.3.3/0"),
        ("j", "6.6.6.6/0"),
        ("k", "7.7.7.7/0"),
    ] {
        assert_eq!(addresses(text, host), expected);
    }
    for host in ["a.", "d", "f", "g", "h", "i!", ""] {
        assert_eq!(addresses(text, host), "ENOTFOUND");
    }
}

#[test]
fn long_names() {
    let [fits, long] = [255, 256].map(|len| "a".repeat(len));
    let text = format!("1.1.1.1 {fits} {long}");
    assert_eq!(addresses(&text, &fits), "1.1.1.1/0");
    assert_eq!(addresses(&text, &long), "ENOTFOUND");
    assert_eq!(hosts(&text).reverse("1.1.1.1"), [fits]);
}

#[test]
fn names_on_several_lines() {
    let text = "1.1.1.1 a\n1.1.1.1 b A\n2.2.2.2 b\n3.3.3.3 C\n3.3.3.3 a c\n::4 a";
    assert_eq!(addresses(text, "a"), "1.1.1.1/0, 3.3.3.3/0");
    assert_eq!(addresses(text, "b"), "1.1.1.1/0, 2.2.2.2/0");
    assert_eq!(addresses(text, "c"), "3.3.3.3/0");
    assert_eq!(hosts(text).lookup("a", Family::Inet6), ["::4/0"]);
    assert_eq!(hosts(text).lookup("b", Family::Inet6), ["ENOTFOUND"]);
    assert_eq!(
        hosts(text).lookup("a", Family::Unspecified),
        ["1.1.1.1/0, 3.3.3.3/0, ::4/0"]
    );
    assert_eq!(hosts(text).reverse("1.1.1.1"), ["b"]);
    assert_eq!(hosts(text).reverse("2.2.2.2"), ["b"]);
    assert_eq!(hosts(text).name_info("3.3.3.3", 80), ["C, http"]);
    assert_eq!(hosts(text).reverse("4.4.4.4"), ["ENOTFOUND"]);
    assert_eq!(hosts("1.1.1.1 a b c b").reverse("1.1.1.1"), ["b, c"]);
}

#[test]
fn many_names_for_an_address() {
    let names: Vec<_> = (0..200).map(|index| format!("h{index}")).collect();
    let text = format!("0.0.0.0 {0}\n0.0.0.0 {0}", names.join("\n0.0.0.0 "));
    assert_eq!(hosts(&text).reverse("0.0.0.0"), [names[1..=100].join(", ")]);
    for name in ["h0", "h100", "h101", "h199"] {
        assert_eq!(addresses(&text, name), "0.0.0.0/0");
    }
    let text = format!("1.1.1.1 a\n{text} a\n2.2.2.2 a\n0.0.0.0 a");
    assert_eq!(addresses(&text, "a"), "1.1.1.1/0, 0.0.0.0/0, 2.2.2.2/0");
}

#[test]
fn read_again_when_it_changes() {
    let changes: [fn(&mut FileStamp); 5] = [
        |stamp| stamp.modified += 1,
        |stamp| stamp.modified -= 1,
        |stamp| stamp.size += 1,
        |stamp| stamp.inode += 1,
        |stamp| stamp.device += 1,
    ];
    let mut test = hosts("1.1.1.1 a");
    for (reads, change) in (1..).zip(changes) {
        test.lookup("a", Family::Inet);
        test.reverse("1.1.1.1");
        assert_eq!(test.world().hosts_reads, reads);
        change(&mut test.world().files.get_mut(HOSTS.as_bytes()).unwrap().1);
    }
}

#[test]
fn changes_within_a_second() {
    let mut test = hosts("1.1.1.1 a");
    test.world().write(HOSTS, "2.2.2.2 a");
    assert_eq!(test.lookup("a", Family::Inet), ["2.2.2.2/0"]);
    test.world().write(HOSTS, "3.3.3.3 a");
    test.world().wall_clock += 1;
    assert_eq!(test.lookup("a", Family::Inet), ["2: 3.3.3.3/0"]);
    test.lookup("a", Family::Inet);
    assert_eq!(test.world().hosts_reads, 2);
}

#[test]
fn file_from_the_future() {
    let mut test = hosts("");
    test.world().write(HOSTS, "1.1.1.1 a");
    test.world().wall_clock -= 1;
    test.lookup("a", Family::Inet);
    test.lookup("a", Family::Inet);
    assert_eq!(test.world().hosts_reads, 1);
}

#[test]
fn file_that_comes_and_goes() {
    let mut test = hosts("1.1.1.1 a");
    assert_eq!(test.lookup("a", Family::Inet), ["1.1.1.1/0"]);
    let (text, stamp) = test.world().files.remove(HOSTS.as_bytes()).unwrap();
    assert_eq!(test.lookup("a", Family::Inet), ["2: ENOTFOUND"]);
    test.world().files.insert(HOSTS.into(), (None, stamp));
    assert_eq!(test.lookup("a", Family::Inet), ["3: ENOTFOUND"]);
    test.world().files.insert(HOSTS.into(), (text, stamp));
    assert_eq!(test.lookup("a", Family::Inet), ["4: 1.1.1.1/0"]);
    test.world().write(HOSTS, "2.2.2.2 a");
    assert_eq!(test.lookup("a", Family::Inet), ["5: 2.2.2.2/0"]);
    test.world().files.remove(HOSTS.as_bytes());
    assert_eq!(test.lookup("a", Family::Inet), ["6: ENOTFOUND"]);
}

#[test]
fn file_without_a_stamp() {
    let mut test = hosts("1.1.1.1 a");
    test.world().has_no_stamps = true;
    test.world().wall_clock = 600;
    for (seconds, reads) in [(0, 1), (59, 1), (1, 2)] {
        test.world().wall_clock += seconds;
        assert_eq!(test.lookup("a", Family::Inet).len(), 1);
        assert!(test.sent().is_empty());
        assert_eq!(test.world().hosts_reads, reads);
    }
}
