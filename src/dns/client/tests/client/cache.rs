use bun_dns_client::{Family, RecordType};

use crate::machine::{NOTHING, Test, one_server};
use crate::servers::{LUCK, after_a_failure};
use crate::wire::*;

fn is_cached(test: &mut Test, name: &str) -> bool {
    let is_cached = !test.resolve(RecordType::A, name).is_empty();
    drop((test.client.cancel(), test.sent()));
    is_cached
}

/// For how many seconds a reply makes a query unnecessary.
fn lifetime(flags: u16, sections: [&[Vec<u8>]; 3]) -> u64 {
    let mut test = one_server().start();
    let query = test.ask("a.test");
    assert_eq!(
        test.deliver(&query, &reply(&query.bytes, flags, sections))
            .len(),
        1
    );
    let mut seconds = 0;
    while is_cached(&mut test, "a.test") {
        test.wait(1000);
        seconds += 1;
    }
    seconds
}

#[test]
fn replies_age() {
    let mut test = one_server().start();
    let query = test.ask("a.test");
    test.answer(&query, &[address("1.1.1.1", 60), address("2.2.2.2", 90)]);
    assert_eq!(
        test.resolve(RecordType::A, "a.test"),
        ["2: 1.1.1.1/60, 2.2.2.2/90"]
    );
    test.wait(59_999);
    assert_eq!(
        test.resolve(RecordType::A, "A.tEsT."),
        ["3: 1.1.1.1/1, 2.2.2.2/31"]
    );
    assert_eq!(
        test.lookup("a.test", Family::Inet),
        ["4: 1.1.1.1/1, 2.2.2.2/31"]
    );
    assert_eq!(test.resolve(RecordType::AAAA, "a.test"), NOTHING);
    assert_eq!(test.resolve(RecordType::A, "b.test"), NOTHING);
    test.wait(1);
    assert!(!is_cached(&mut test, "a.test"));
}

#[test]
fn positive() {
    let alias = record(CNAME, 5, &name("c.test"));
    assert_eq!(
        lifetime(0, [&[address("1.1.1.1", 9)], &[soa(1, 1)], &[soa(1, 1)]]),
        9
    );
    for other in [alias, soa(5, 9)] {
        assert_eq!(lifetime(0, [&[address("1.1.1.1", 9), other], &[], &[]]), 5);
    }
    for (ttl, expected) in [(0, 0), (1, 1), (9999, 3600), (u32::MAX, 3600)] {
        assert_eq!(
            lifetime(0, [&[address("1.1.1.1", ttl)], &[], &[]]),
            expected
        );
    }
}

#[test]
fn negative() {
    let alias = || record(CNAME, 5, &name("c.test"));
    let ns = || record(NS, 1, &name("n.test"));
    for code in [0, NXDOMAIN] {
        assert_eq!(lifetime(code, [&[], &[soa(7, 9)], &[]]), 7);
        assert_eq!(lifetime(code, [&[], &[ns(), soa(9, 7)], &[]]), 7);
        assert_eq!(lifetime(code, [&[alias()], &[soa(9, 9)], &[]]), 5);
        assert_eq!(lifetime(code, [&[], &[soa(9999, 9999)], &[]]), 3600);
        assert_eq!(lifetime(code, [&[alias()], &[], &[]]), 0);
        assert_eq!(lifetime(code, [&[], &[ns()], &[soa(9, 9)]]), 0);
        let too_long = [ASKED, &numbers(&[NS, IN, 0, 9, 999])].concat();
        assert_eq!(lifetime(code, [&[], &[too_long, soa(9, 9)], &[]]), 0);
        for len in 0..22 {
            let cut = record(SOA, 9, &[0; 22][..len]);
            assert_eq!(lifetime(code, [&[], &[cut], &[]]), 0);
        }
    }
    assert_eq!(lifetime(NXDOMAIN, [&[address("1.1.1.1", 9)], &[], &[]]), 0);
    for code in [FORMERR, SERVFAIL, REFUSED] {
        assert_eq!(
            lifetime(code, [&[address("1.1.1.1", 9)], &[soa(9, 9)], &[]]),
            0
        );
    }
}

#[test]
fn expired_reply_makes_way() {
    for ms in [1000, 9000] {
        let mut test = one_server().start();
        let query = test.ask("a.test");
        test.answer(&query, &[address("1.1.1.1", 1)]);
        test.wait(ms);
        let query = test.ask("a.test");
        test.answer(&query, &[address("2.2.2.2", 5)]);
        assert_eq!(test.resolve(RecordType::A, "a.test"), ["3: 2.2.2.2/5"]);
    }
}

#[test]
fn expired_reply_makes_way_for_one_that_took_longer() {
    let mut test = one_server().start();
    test.ask("a.test");
    test.wait(2000);
    let (old, new) = (test.sent_one(), test.ask("a.test"));
    test.answer(&new, &[address("1.1.1.1", 1)]);
    test.wait(1000);
    test.answer(&old, &[address("2.2.2.2", 60)]);
    assert_eq!(test.resolve(RecordType::A, "a.test"), ["3: 2.2.2.2/60"]);
}

#[test]
fn each_reply_has_its_own_time() {
    let mut test = one_server().start();
    for index in 0..400 {
        let query = test.ask(&format!("{index}.test"));
        test.answer(&query, &[address("1.1.1.1", 5 + index % 2)]);
    }
    test.wait(5000);
    let cached = (0..400).filter(|index| is_cached(&mut test, &format!("{index}.test")));
    assert!(cached.eq((1..400).step_by(2)));
}

#[test]
fn new_servers_start_over() {
    let mut test = one_server().start();
    let query = test.ask("a.test");
    test.answer(&query, &[address("1.1.1.1", 9)]);
    test.set_servers(&["10.0.0.1:53"]);
    assert!(!is_cached(&mut test, "a.test"));
}

#[test]
fn starts_over_when_it_is_full() {
    for len in [64_935, 65_125] {
        let mut test = one_server().start();
        let padding = record(HINFO, 3600, &vec![0; len]);
        for index in 0..300 {
            let query = test.ask(&format!("{index}.test"));
            test.answer(&query, &[address("1.1.1.1", 999 - index), padding.clone()]);
        }
        let cached = (0..300).filter(|index| is_cached(&mut test, &format!("{index}.test")));
        assert!(cached.eq(257..300));
    }
}

#[test]
fn reply_to_a_probe_is_not_kept() {
    let mut test = after_a_failure(5000);
    test.world().randoms.push_back(LUCK);
    test.resolve(RecordType::A, "b.test");
    let [query, probe] = test.sent_exactly();
    assert_eq!(test.answer(&probe, &[address("1.1.1.1", 9)]), NOTHING);
    assert_eq!(test.resolve(RecordType::A, "b.test"), NOTHING);
    let expected = ["2: 2.2.2.2/9", "3: 2.2.2.2/9"];
    assert_eq!(test.answer(&query, &[address("2.2.2.2", 9)]), expected);
    assert_eq!(test.resolve(RecordType::A, "b.test"), ["4: 2.2.2.2/9"]);
}
