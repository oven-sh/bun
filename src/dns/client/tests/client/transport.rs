use std::collections::BTreeSet;

use bun_dns_client::SocketError::{Failed, WouldBlock};
use bun_dns_client::{Events, Family, RecordType, Transport};

use crate::machine::{NOTHING, Sent, Setup, Test, one_server, resolv_conf, shown, two_servers};
use crate::wire::*;

fn over_tcp() -> Setup {
    resolv_conf("nameserver 10.0.0.1\noptions use-vc")
}

fn good(to: &Sent) -> Vec<u8> {
    reply(&to.bytes, 0, [&[address("1.1.1.1", 60)], &[], &[]])
}

const GOOD: [&str; 1] = ["1.1.1.1/60"];

#[test]
fn socket_is_shared_while_it_is_busy() {
    let mut test = one_server().start();
    let [a, b] = ["a.test", "b.test"].map(|name| test.ask(name));
    assert_eq!((a.socket, b.socket), (0, 0));
    assert_eq!(test.deliver(&b, &good(&b)), ["2: 1.1.1.1/60"]);
    assert!(!test.is_idle());
    assert_eq!(test.deliver(&a, &good(&a)), GOOD);
    assert!(test.is_idle());
    assert_eq!(test.world().opened[0].watches, [false]);
    assert_eq!(test.ask("c.test").socket, 1);

    let mut test = resolv_conf("search s").start();
    test.lookup("a", Family::Inet);
    test.decline(&test.sent_one(), NXDOMAIN);
    assert_eq!(test.sent_one().socket, 0);
}

#[test]
fn one_event_reads_all_there_is() {
    let mut test = one_server().start();
    let [a, b, c] = ["a.test", "b.test", "c.test"].map(|name| test.ask(name));
    test.arrive(0, &good(&b));
    assert_eq!(test.deliver(&a, &good(&a)), ["2: 1.1.1.1/60", GOOD[0]]);
    assert_eq!(test.world().opened[0].receive_calls, 3);
    assert_eq!(test.deliver(&c, &good(&c)), ["3: 1.1.1.1/60"]);
    assert_eq!(test.world().opened[0].receive_calls, 4);
}

#[test]
fn events_without_a_cause() {
    for setup in [one_server(), over_tcp()] {
        let mut test = setup.start();
        let query = test.ask("a.test");
        assert_eq!(test.process(0, true, true), NOTHING);
        assert_eq!(test.process(0, false, false), NOTHING);
        assert_eq!(test.world().send_calls, 1);
        assert_eq!(test.world().opened[0].receive_calls, 1);
        assert_eq!(shown(&test.client.process(99, Events::default())), NOTHING);
        assert_eq!(test.deliver(&query, &good(&query)), GOOD);
    }
}

#[test]
fn ids_on_a_socket_differ() {
    let mut test = one_server().start();
    test.world().randoms.extend([7, 8, 7, 8, 9]);
    let ids = ["a.test", "b.test", "c.test"].map(|name| test.ask(name).id());
    assert_eq!(ids, [7, 8, 9]);
}

#[test]
fn queries_are_spread_over_sockets() {
    for (setup, per_socket) in [(one_server(), 64), (over_tcp(), 32768)] {
        let mut test = setup.start();
        test.world().randoms.extend((0..=u16::MAX).chain(0..9));
        let first = test.ask("first.test");
        for index in 1..2 * per_socket + 1 {
            assert_eq!(
                test.ask(&format!("{index}.test")).socket,
                index / per_socket
            );
        }
        assert_eq!(test.deliver(&first, &good(&first)), GOOD);
        assert_eq!(test.client.cancel().len(), 2 * per_socket);
        assert!(test.is_idle());
    }
}

#[test]
fn answered_queries_count_for_the_socket() {
    let mut test = one_server().start();
    test.ask("slow.test");
    for index in 1..64 {
        let query = test.ask(&format!("{index}.test"));
        assert_eq!(query.socket, 0);
        assert_eq!(test.deliver(&query, &good(&query)).len(), 1);
    }
    assert_eq!(test.ask("next.test").socket, 1);
}

#[test]
fn socket_that_is_a_second_old() {
    for (setup, more, expected) in [
        (one_server(), 1, 1),
        (one_server(), 500, 1),
        (over_tcp(), 1, 0),
    ] {
        let mut test = setup.start();
        test.ask("a.test");
        test.wait(999);
        assert_eq!(test.ask("b.test").socket, 0);
        test.wait(more);
        assert_eq!(test.ask("c.test").socket, expected);
    }
}

#[test]
fn full_socket_is_better_than_none() {
    let mut test = one_server().tries(1).start();
    test.world().randoms.extend(0..=u16::MAX);
    test.ask("first.test");
    test.world().unreachable = test.client.servers().collect();
    test.wait(1000);
    for index in 1..32768 {
        assert_eq!(test.ask(&format!("{index}.test")).socket, 0);
    }
    assert_eq!(test.world().connect_calls, 11);
    assert_eq!(test.resolve(RecordType::A, "last.test").len(), 1);
}

#[test]
fn new_socket_soon_after_there_was_none() {
    let mut test = one_server().start();
    for index in 0..128 {
        let is_full = index == 64;
        test.world().unreachable = test.client.servers().filter(|_| is_full).collect();
        assert_eq!(test.ask(&format!("{index}.test")).socket, 0);
    }
    assert_eq!(test.ask("last.test").socket, 1);
}

#[test]
fn new_stream_as_soon_as_there_is_one() {
    let mut test = over_tcp().start();
    test.ask("a.test");
    test.wait(1);
    test.ask("b.test");
    test.world().unreachable = test.client.servers().collect();
    test.wait(1999);
    assert_eq!(test.sent_one().socket, 0);
    test.world().unreachable.clear();
    assert_eq!(test.ask("c.test").socket, 1);
}

#[test]
fn stream_that_is_far_behind_is_no_better_than_none() {
    let mut test = over_tcp().tries(1).start();
    test.world().streams_take_time = true;
    // 256 bytes with the header, the type, the class and the length.
    let name = |index| format!("{index:058}.{0:058}.{0:058}.{0:059}", 0);
    test.resolve(RecordType::A, name(0));
    test.wait(1);
    test.resolve(RecordType::A, name(1));
    test.world().unreachable = test.client.servers().collect();
    assert_eq!(test.wait(1999), ["ETIMEOUT"]);
    for index in 2..32768 {
        assert_eq!(test.resolve(RecordType::A, name(index)), NOTHING);
    }
    let last = test.resolve(RecordType::A, "last.test");
    assert_eq!(last, ["32769: ECONNREFUSED"]);
}

#[test]
fn old_socket_is_better_than_none() {
    let mut test = one_server().start();
    let mut last = test.ask("first.test");
    test.world().unreachable = test.client.servers().collect();
    for second in 1..70 {
        test.wait(1000);
        let [a, b] = ["a", "b"].map(|name| test.ask(&format!("{second}.{name}.test")));
        assert_eq!((a.socket, b.socket), (0, 0));
        assert_eq!(test.world().connect_calls, 1 + second);
        test.deliver(&last, &good(&last));
        test.deliver(&a, &good(&a));
        last = b;
    }
}

#[test]
fn many_sockets_are_filled_up() {
    let mut test = one_server().start();
    test.world().randoms.extend(0..=u16::MAX);
    let full = 255 * 64 + 32768;
    for index in 0..full {
        let query = test.ask(&format!("{index}.test"));
        assert_eq!(query.socket, (index / 64).min(255));
    }
    for index in 0..65 {
        assert_eq!(test.ask(&format!("{index}.a.test")).socket, 256);
    }
    test.wait(1000);
    assert_eq!(test.ask("b.test").socket, 257);
}

#[test]
fn old_socket_is_better_than_too_many() {
    let mut setup = one_server().tries(1);
    setup.timeout_ms = Some(600_000);
    let mut test = setup.start();
    for second in 0..600 {
        assert_eq!(test.ask(&format!("{second}.test")).socket, second.min(511));
        test.wait(1000);
    }
    assert_eq!(test.open_sockets(), 511);
    test.world().randoms.extend(1..=u16::MAX);
    for index in 0..32769 {
        let query = test.ask(&format!("{index}.a.test"));
        assert_eq!(query.socket, 512 + index / 32768);
    }
}

#[test]
fn retries_are_spread_over_sockets() {
    let mut test = one_server().start();
    for index in 0..200 * 64 {
        test.ask(&format!("{index}.test"));
    }
    test.wait(2000);
    assert_eq!(test.open_sockets(), 200);
}

#[test]
fn number_of_a_closed_socket_comes_back() {
    let mut test = resolv_conf("nameserver 10.0.0.1 10.0.0.2\noptions rotate").start();
    let ask = |test: &mut Test, name, server| {
        test.world().randoms.push_back(server);
        test.ask(name)
    };
    let a = ask(&mut test, "a.test", 0);
    test.decline(&a, REFUSED);
    ask(&mut test, "b.test", 1);
    let c = ask(&mut test, "c.test", 0);
    assert_eq!(test.server_of(&c), "10.0.0.1:53");

    let mut test = one_server().start();
    let a = test.ask("a.test");
    test.decline(&a, TRUNCATED);
    let again = test.sent_one();
    test.decline(&again, REFUSED);
    test.ask("b.test");
    test.wait(1000);
    let c = test.ask("c.test");
    test.decline(&c, TRUNCATED);
    assert_eq!(test.transport_of(&test.sent_one()), Transport::Tcp);
}

#[test]
fn same_question_is_asked_once() {
    let mut test = one_server().start();
    let query = test.ask("a.test");
    assert_eq!(test.resolve(RecordType::A, "A.tEst."), NOTHING);
    assert_eq!(test.lookup("a.test", Family::Inet), NOTHING);
    assert!(test.sent().is_empty());
    let expected = ["EREFUSED", "2: EREFUSED", "3: EREFUSED"];
    assert_eq!(test.decline(&query, REFUSED), expected);
    assert!(test.is_idle());
    test.ask("a.test");
}

#[test]
fn same_question_after_a_timeout() {
    let mut test = one_server().start();
    test.ask("a.test");
    assert_eq!(test.wait(2000), NOTHING);
    let (old, new) = (test.sent_one(), test.ask("a.test"));
    assert_eq!(test.resolve(RecordType::A, "a.test"), NOTHING);
    assert!(test.sent().is_empty());
    let expected = ["2: 1.1.1.1/60", "3: 1.1.1.1/60"];
    assert_eq!(test.deliver(&new, &good(&new)), expected);
    assert_eq!(test.answer(&old, &[address("2.2.2.2", 99)]), ["2.2.2.2/99"]);
    assert_eq!(test.resolve(RecordType::A, "a.test"), ["4: 1.1.1.1/60"]);
    test.wait(60_000);
    test.ask("a.test");
}

#[test]
fn messages_that_answer_nothing() {
    for setup in [one_server(), over_tcp()] {
        let mut test = setup.tries(1).start();
        let query = test.ask("a.test");
        let changed = |at: usize, mask: u8| {
            let mut message = good(&query);
            message[at] ^= mask;
            message
        };
        let (id, flags, name, kind, class) = (1, 2, 13, 21, 23);
        let whole = good(&query);
        for message in [
            changed(id, 1),
            changed(flags, 0x80),
            changed(flags, 0x08),
            changed(flags, 0x40),
            changed(name, 3),
            changed(kind, 3),
            changed(class, 2),
            whole[..0].to_vec(),
            whole[..1].to_vec(),
            whole[..3].to_vec(),
            whole[..11].to_vec(),
            whole[..23].to_vec(),
        ] {
            assert_eq!(test.deliver(&query, &message), NOTHING);
            assert!(test.sent().is_empty());
        }
        assert_eq!(test.deliver(&query, &changed(name, 0x20)), GOOD);
    }
}

#[test]
fn senders() {
    let mut test = two_servers().start();
    let query = test.ask("a.test");
    for sender in [
        "10.0.0.2:53",
        "10.0.0.1:54",
        "10.0.0.1:0",
        "[::ffff:10.0.0.1]:53",
    ] {
        test.arrive_from(0, &good(&query), sender);
        assert_eq!(test.process(0, true, false), NOTHING);
    }
    assert_eq!(test.deliver(&query, &good(&query)), GOOD);
}

#[test]
fn unspecified_address_is_this_machine() {
    for (server, peer) in [("0.0.0.0:54", "127.0.0.1:54"), ("[::]:54", "[::1]:54")] {
        let mut test = one_server().start();
        test.set_servers(&[server]);
        let query = test.ask("a.test");
        assert_eq!(test.server_of(&query), peer);
        assert_eq!(test.servers(), [server]);
        assert_eq!(test.deliver(&query, &good(&query)), GOOD);
    }
}

#[test]
fn reading_takes_turns_with_the_event_loop() {
    for (count, expected) in [(63, [2, 0]), (64, [0, 2])] {
        for len in [0, 2] {
            let mut test = one_server().start();
            let [a, b] = ["a.test", "b.test"].map(|name| test.ask(name));
            (0..count).for_each(|_| test.arrive(0, &a.bytes[..len]));
            test.arrive(0, &good(&a));
            test.arrive(0, &good(&b));
            assert_eq!(
                [(); 2].map(|()| test.process(0, true, false).len()),
                expected
            );
        }
        let (mut test, replies) = two_on_a_stream();
        let long = frame(&vec![0; u16::MAX.into()]);
        test.arrive(0, &[frame(b"").repeat(count), long, replies].concat());
        assert_eq!(
            [(); 2].map(|()| test.process(0, true, false).len()),
            expected
        );
    }
}

#[test]
fn reply_that_cannot_be_read() {
    for setup in [one_server(), over_tcp()] {
        let mut test = setup.tries(2).start();
        let [a, b] = ["a.test", "b.test"].map(|name| test.ask(name));
        assert_eq!(test.deliver(&a, &good(&a)[..30]), NOTHING);
        let again = test.sent_one();
        assert_eq!((again.question(), again.socket), (a.question(), 0));
        assert_eq!(test.deliver(&b, &good(&b)), ["2: 1.1.1.1/60"]);
        assert_eq!(test.deliver(&again, &good(&again)[..30]), ["EBADRESP"]);
        assert!(test.is_idle());
    }

    let mut test = two_servers().start();
    let query = test.ask("a.test");
    test.deliver(&query, &good(&query)[..30]);
    assert_eq!(test.server_of(&test.sent_one()), "10.0.0.2:53");
}

#[test]
fn reply_without_one_question() {
    let outcome = |change: &dyn Fn(&mut Vec<u8>)| {
        let mut test = one_server().tries(1).start();
        let query = test.ask("a.test");
        let mut message = good(&query);
        change(&mut message);
        test.deliver(&query, &message)
    };
    for count in [0, 2] {
        assert_eq!(outcome(&|message| message[5] = count), ["EBADRESP"]);
    }
    let header = |message: &mut Vec<u8>| {
        message[5] = 0;
        message.truncate(12);
    };
    assert_eq!(outcome(&header), ["EBADRESP"]);
    let answer_only = |message: &mut Vec<u8>| {
        message[5] = 0;
        message.drain(12..24);
    };
    assert_eq!(outcome(&answer_only), ["EBADRESP"]);
}

#[test]
fn truncated() {
    let mut test = one_server().tries(1).start();
    let query = test.ask("a.test");
    let half = reply(&query.bytes, TRUNCATED, [&[ASKED.to_vec()], &[], &[]]);
    assert_eq!(test.deliver(&query, &half), NOTHING);
    let again = test.sent_one();
    assert_eq!(test.transport_of(&again), Transport::Tcp);
    assert_eq!(
        (again.question(), test.open_sockets()),
        (query.question(), 1)
    );

    let still = reply(
        &again.bytes,
        TRUNCATED,
        [&[address("1.1.1.1", 60)], &[], &[]],
    );
    assert_eq!(test.deliver(&again, &still), GOOD);
    assert!(test.is_idle());
    let next = test.ask("a.test");
    assert_eq!(test.transport_of(&next), Transport::Udp);
}

#[test]
fn truncated_among_others() {
    let mut test = one_server().start();
    let [a, b, _] = ["a.test", "b.test", "c.test"].map(|name| test.ask(name));
    test.arrive(0, &reply(&a.bytes, TRUNCATED, [&[], &[], &[]]));
    test.decline(&b, TRUNCATED);
    let again = test.sent_exactly().map(|it| it.question());
    assert_eq!(again, [a.question(), b.question()]);
    assert_eq!(test.ask("d.test").socket, 0);
}

#[test]
fn refusals_are_final() {
    for code in [FORMERR, SERVFAIL, NXDOMAIN, REFUSED] {
        let mut test = two_servers().start();
        let query = test.ask("a.test");
        assert_eq!(test.decline(&query, code).len(), 1);
        assert_eq!(test.servers(), ["10.0.0.1:53", "10.0.0.2:53"]);
        assert!(test.is_idle());
    }
}

#[test]
fn each_try_has_an_id_and_a_socket_of_its_own() {
    for setup in [one_server(), over_tcp()] {
        let mut test = setup.start();
        let mut tries = vec![test.ask("a.test")];
        let slow = test.ask("b.test");
        assert_eq!(test.wait(1999), NOTHING);
        assert!(test.sent().is_empty());
        test.deliver(&slow, &good(&slow));
        for _ in 0..3 {
            assert_eq!(test.wait(60_000), NOTHING);
            tries.push(test.sent_one());
            assert_eq!(test.open_sockets(), 1);
        }
        assert_eq!(tries.iter().map(Sent::id).collect::<BTreeSet<_>>().len(), 4);
        assert!(tries.iter().map(|it| it.socket).eq(0..4));
        assert_eq!(test.deliver(&tries[3], &good(&tries[2])), NOTHING);
        assert_eq!(test.wait(60_000), ["ETIMEOUT"]);
        assert!(test.is_idle());
    }
}

#[test]
fn socket_with_a_timeout_serves_those_it_has() {
    let mut test = over_tcp().start();
    let a = test.ask("a.test");
    test.wait(1000);
    let b = test.ask("b.test");
    test.wait(1000);
    assert_eq!((test.sent_one().socket, test.ask("c.test").socket), (1, 1));
    assert_eq!(test.deliver(&a, &good(&a)), NOTHING);
    assert_eq!(test.deliver(&b, &good(&b)), ["2: 1.1.1.1/60"]);
    assert_eq!(test.open_sockets(), 1);
}

#[test]
fn what_has_arrived_is_not_late() {
    let mut test = one_server().tries(1).start();
    let a = test.ask("a.test");
    test.wait(1000);
    let b = test.ask("b.test");
    test.arrive(b.socket, &good(&b));
    test.world().now += core::time::Duration::from_secs(9);
    assert_eq!(test.deliver(&a, &good(&a)), [GOOD[0], "2: 1.1.1.1/60"]);

    let c = test.ask("c.test");
    test.arrive(c.socket, &good(&c));
    assert_eq!(test.wait(9000), ["3: 1.1.1.1/60"]);
}

#[test]
fn one_last_look_at_each_socket() {
    let mut test = resolv_conf("nameserver 10.0.0.1 10.0.0.2\noptions rotate").start();
    for (name, server) in [("a.test", 0), ("b.test", 1), ("c.test", 0)] {
        test.world().randoms.push_back(server);
        test.ask(name);
    }
    test.wait(2000);
    assert_eq!(
        [0, 1].map(|it| test.world().opened[it].receive_calls),
        [1, 1]
    );
}

#[test]
fn events_also_look_at_the_clock() {
    let mut test = one_server().tries(1).start();
    let [_, b] = ["a.test", "b.test"].map(|name| test.ask(name));
    test.world().now += core::time::Duration::from_secs(2);
    assert_eq!(test.deliver(&b, &good(&b)), ["2: 1.1.1.1/60", "ETIMEOUT"]);
}

#[test]
fn timeouts_come_in_order() {
    let mut test = one_server().tries(1).start();
    test.ask("a.test");
    test.ask("b.test");
    test.wait(1);
    test.ask("c.test");
    assert_eq!(test.wait(9999), ["ETIMEOUT", "2: ETIMEOUT", "3: ETIMEOUT"]);
}

#[test]
fn no_socket() {
    for (tries, calls) in [(1, 2), (3, 6), (u32::MAX, 128)] {
        let mut test = two_servers().tries(tries).start();
        let servers = test.client.servers().collect();
        test.world().unreachable = servers;
        assert_eq!(test.resolve(RecordType::A, "a.test"), ["ECONNREFUSED"]);
        assert_eq!(test.world().connect_calls, calls);
        assert!(test.is_idle());
    }
}

#[test]
fn next_server_if_there_is_no_socket() {
    let mut test = two_servers().start();
    test.world().unreachable = vec!["10.0.0.1:53".parse().unwrap()];
    let query = test.ask("a.test");
    assert_eq!(test.server_of(&query), "10.0.0.2:53");
}

#[test]
fn send_fails() {
    let mut test = two_servers().start();
    test.ask("a.test");
    test.world().send_results.push_back(Err(Failed));
    assert_eq!(test.resolve(RecordType::A, "b.test"), NOTHING);
    let [a, b] = test.sent_exactly();
    assert_eq!([a.question(), b.question()], ["a.test A", "b.test A"]);
    assert_eq!(test.server_of(&a), "10.0.0.2:53");
    assert_eq!(test.open_sockets(), 1);

    let mut test = one_server().start();
    test.world().send_results.extend([Err(Failed); 4]);
    assert_eq!(test.resolve(RecordType::A, "a.test"), ["ECONNREFUSED"]);
    assert!(test.is_idle());
}

#[test]
fn receive_fails() {
    for setup in [one_server(), over_tcp()] {
        let mut test = setup.tries(2).start();
        let names = ["a.test", "b.test", "c.test", "d.test"];
        let [_, b, _, _] = names.map(|name| test.ask(name));
        assert_eq!(test.deliver(&b, &good(&b)), ["2: 1.1.1.1/60"]);
        test.break_socket(0);
        assert_eq!(test.process(0, true, false), NOTHING);
        let again = test.sent_exactly().map(|it| it.question());
        assert_eq!(again, ["a.test A", "c.test A", "d.test A"]);
        test.break_socket(1);
        let expected = ["ECONNREFUSED", "3: ECONNREFUSED", "4: ECONNREFUSED"];
        assert_eq!(test.process(1, true, false), expected);
        assert!(test.is_idle());
    }
}

#[test]
fn replies_before_a_failure_count() {
    let mut test = one_server().tries(1).start();
    let [a, _] = ["a.test", "b.test"].map(|name| test.ask(name));
    test.arrive(0, &good(&a));
    test.break_socket(0);
    assert_eq!(test.process(0, true, false), [GOOD[0], "2: ECONNREFUSED"]);
}

#[test]
fn error_on_a_socket() {
    for streams_take_time in [false, true] {
        let mut test = over_tcp().tries(1).start();
        test.world().streams_take_time = streams_take_time;
        test.resolve(RecordType::A, "a.test");
        assert_eq!(test.process_error(0), ["ECONNREFUSED"]);
        assert!(test.is_idle());
    }

    let mut test = two_servers().start();
    let query = test.ask("a.test");
    test.arrive(0, &good(&query));
    assert_eq!(test.process_error(0), GOOD);
    assert_eq!(test.servers(), ["10.0.0.1:53", "10.0.0.2:53"]);

    let mut test = resolv_conf("search s").start();
    test.lookup("a", Family::Inet);
    let query = test.sent_one();
    test.arrive(0, &reply(&query.bytes, NXDOMAIN, [&[], &[], &[]]));
    assert_eq!(test.process_error(0), NOTHING);
    assert_eq!(test.sent_one().socket, 1);
}

#[test]
fn last_error_is_reported() {
    let mut test = one_server().tries(2).start();
    test.ask("a.test");
    test.break_socket(0);
    test.process(0, true, false);
    assert_eq!(test.wait(60_000), ["ETIMEOUT"]);
}

#[test]
fn datagrams_wait_for_room() {
    let results = [Err(WouldBlock), Ok(0), Err(WouldBlock)];
    for (results, events) in [(&results[..], 2), (&results[1..], 1)] {
        let mut test = one_server().start();
        test.world().send_results.extend([Err(WouldBlock); 3]);
        for name in ["a.test", "b.test", "c.test"] {
            assert_eq!(test.resolve(RecordType::A, name), NOTHING);
        }
        assert_eq!(test.ask("d.test").question(), "d.test A");
        test.world().send_results.extend(results);
        (0..events).for_each(|_| drop(test.process(0, false, true)));
        let [a] = test.sent_exactly();
        assert_eq!(test.deliver(&a, &good(&a)), GOOD);
        test.process(0, false, true);
        assert_eq!(
            test.sent_exactly().map(|it| it.question()),
            ["b.test A", "c.test A"]
        );
        assert_eq!(test.world().opened[0].watches, [true, false]);
    }
}

#[test]
fn datagrams_that_a_writable_socket_does_not_take_are_lost() {
    let mut test = one_server().start();
    test.world().send_results.extend([Err(WouldBlock); 6]);
    for name in ["a.test", "b.test", "c.test"] {
        test.resolve(RecordType::A, name);
    }
    assert_eq!(test.process(0, false, true), NOTHING);
    assert_eq!(test.world().opened[0].watches, [true]);
    assert_eq!(test.process(0, false, true), NOTHING);
    assert_eq!(test.sent_exactly().map(|it| it.question()), ["c.test A"]);
    assert_eq!(test.world().opened[0].watches, [true, false]);
    test.wait(2000);
    assert_eq!(test.sent().len(), 3);
}

#[test]
fn datagram_that_waits_for_too_long() {
    for first in [Err(WouldBlock), Ok(0)] {
        let mut test = one_server().tries(1).start();
        test.world().send_results.extend([first, Err(WouldBlock)]);
        test.resolve(RecordType::A, "a.test");
        test.sent();
        test.wait(1);
        test.resolve(RecordType::A, "b.test");
        assert_eq!(test.wait(1999), ["ETIMEOUT"]);
        test.process(0, false, true);
        assert_eq!(test.sent_one().question(), "b.test A");
    }
}

#[test]
fn newer_datagram_takes_the_room() {
    let mut test = one_server().start();
    test.world().send_results.extend([Err(WouldBlock); 2]);
    test.resolve(RecordType::A, "a.test");
    test.process(0, false, true);
    test.ask("b.test");
    test.world().send_results.push_back(Err(WouldBlock));
    test.process(0, false, true);
    test.process(0, false, true);
    assert_eq!(test.sent_one().question(), "a.test A");
}

#[test]
fn reply_to_a_datagram_that_waits() {
    let mut test = one_server().tries(2).start();
    test.world().randoms.extend([7, 8, 7]);
    let a = test.ask("a.test");
    test.wait(1);
    test.ask("b.test");
    test.world().unreachable = test.client.servers().collect();
    test.world().send_results.push_back(Err(WouldBlock));
    assert_eq!(test.wait(1999), NOTHING);
    assert_eq!(test.world().opened[0].watches, [false, true]);
    assert_eq!(test.deliver(&a, &good(&a)), GOOD);
    test.process(0, false, true);
    assert!(test.sent().is_empty());
    assert_eq!(test.world().opened[0].watches, [false, true, false]);
}

#[test]
fn flush_fails() {
    let as_it_is: fn(&[u8]) -> Vec<u8> = <[u8]>::to_vec;
    for (setup, wrap) in [(one_server(), as_it_is), (over_tcp(), frame)] {
        let mut test = setup.tries(1).start();
        let a = test.ask("a.test");
        test.world()
            .send_results
            .extend([Err(WouldBlock), Err(Failed)]);
        test.resolve(RecordType::A, "b.test");
        test.arrive(0, &wrap(&good(&a)));
        assert_eq!(test.process(0, true, true), [GOOD[0], "2: ECONNREFUSED"]);
        assert!(test.is_idle());
    }
}

#[test]
fn stream_that_does_not_connect() {
    let mut test = over_tcp().tries(1).start();
    test.world().streams_take_time = true;
    test.resolve(RecordType::A, "a.test");
    assert_eq!(test.process(0, true, false), NOTHING);
    assert_eq!(test.wait(2000), ["ETIMEOUT"]);
    assert_eq!(test.world().opened[0].receive_calls, 0);
}

#[test]
fn stream_that_is_still_connecting() {
    let mut test = over_tcp().start();
    test.world().streams_take_time = true;
    test.resolve(RecordType::A, "a.test");
    test.resolve(RecordType::A, "b.test");
    assert_eq!(test.world().send_calls, 0);
    test.process(0, false, true);
    assert_eq!((test.sent().len(), test.world().send_calls), (2, 1));
    assert_eq!(test.ask("c.test").socket, 0);
    assert_eq!(test.world().opened[0].watches, [true, false]);
}

#[test]
fn stream_without_room() {
    for result in [Err(WouldBlock), Ok(25)] {
        let mut test = over_tcp().start();
        test.world().send_results.push_back(result);
        test.resolve(RecordType::A, "a.test");
        test.resolve(RecordType::A, "b.test");
        assert_eq!(test.world().send_calls, 1);
        test.process(0, false, true);
        assert_eq!(
            test.sent_exactly().map(|it| it.question()),
            ["a.test A", "b.test A"]
        );
        assert_eq!(test.world().opened[0].watches, [true, false]);
    }
}

#[test]
fn stream_that_takes_a_byte_at_a_time() {
    let mut test = over_tcp().start();
    test.world().send_results.extend([Ok(1); 51]);
    test.resolve(RecordType::A, "a.test");
    test.resolve(RecordType::A, "b.test");
    (0..51).for_each(|_| assert_eq!(test.process(0, false, true), NOTHING));
    assert_eq!(
        test.sent_exactly().map(|it| it.question()),
        ["a.test A", "b.test A"]
    );
    assert_eq!(test.world().opened[0].watches, [true, false]);
}

fn two_on_a_stream() -> (Test, Vec<u8>) {
    let mut test = over_tcp().tries(1).start();
    let replies = ["a.test", "b.test"].map(|name| frame(&good(&test.ask(name))));
    (test, replies.concat())
}

#[test]
fn stream_in_pieces() {
    let len = two_on_a_stream().1.len();
    for piece in 1..=len {
        let (mut test, stream) = two_on_a_stream();
        let mut answers = Vec::new();
        for piece in stream.chunks(piece) {
            test.arrive(0, piece);
            answers.extend(test.process(0, true, false));
        }
        assert_eq!(answers, [GOOD[0], "2: 1.1.1.1/60"]);
        assert!(test.is_idle());
    }
}

#[test]
fn stream_is_read_once() {
    let mut test = over_tcp().start();
    test.world().randoms.extend([7, 8, 7]);
    let [a, _] = ["a.test", "b.test"].map(|name| test.ask(name));
    assert_eq!(test.decline(&a, REFUSED), ["EREFUSED"]);
    assert_eq!(test.world().opened[0].receive_calls, 1);
    let again = test.ask("a.test");
    assert_eq!(test.deliver(&again, &good(&again)), ["3: 1.1.1.1/60"]);
}

#[test]
fn stream_that_ends() {
    let len = two_on_a_stream().1.len();
    for end in 1..len {
        let (mut test, stream) = two_on_a_stream();
        test.arrive(0, &stream[..end]);
        test.break_socket(0);
        let answers = [test.process(0, true, false), test.process(0, true, false)];
        let first = if end < len / 2 {
            "ECONNREFUSED"
        } else {
            GOOD[0]
        };
        assert_eq!(answers.concat(), [first, "2: ECONNREFUSED"]);
    }
}

#[test]
fn stream_with_more_than_one_read_takes() {
    let mut test = over_tcp().start();
    let mut stream = Vec::new();
    for name in ["a.test", "b.test", "c.test", "d.test"] {
        let query = test.ask(name);
        let padding = record(HINFO, 60, &vec![0; usize::from(u16::MAX) - 52]);
        let message = reply(
            &query.bytes,
            0,
            [&[address("1.1.1.1", 60), padding], &[], &[]],
        );
        assert_eq!(message.len(), usize::from(u16::MAX));
        stream.extend(frame(&message));
    }
    test.arrive(0, &stream);
    let answers = [test.process(0, true, false), test.process(0, true, false)];
    assert_eq!(answers.concat().len(), 4);
}

#[test]
fn local_address() {
    let mut test = one_server().start();
    let mut local_for = |server: &str, local: &str| {
        test.client.set_local_ip(local.parse().unwrap());
        drop(test.client.cancel());
        test.set_servers(&[server]);
        let socket = test.ask("a.test").socket;
        let local = test.world().opened[socket].local;
        local.map(|ip| ip.to_string()).unwrap_or_default()
    };
    assert_eq!(local_for("10.0.0.1:53", "1::1"), "");
    assert_eq!(local_for("[2::2]:53", "1.1.1.1"), "1::1");
    assert_eq!(local_for("10.0.0.1:53", "::"), "1.1.1.1");
    assert_eq!(local_for("[2::2]:53", "0.0.0.0"), "");
    assert_eq!(local_for("10.0.0.1:53", "::"), "");
}

fn one_request_of_each_kind() -> Test {
    let mut test = one_server().start();
    test.resolve(RecordType::A, "a.test");
    test.lookup("b.test", Family::Unspecified);
    test.reverse("1.1.1.1");
    test.name_info("2.2.2.2", 1);
    let [a, b, ..] = test.sent_exactly::<5>();
    test.decline(&a, TRUNCATED);
    test.answer(&b, &[address("1.1.1.1", 60)]);
    assert!(test.client.has_requests());
    test.sent();
    test
}

#[test]
fn cancel() {
    let mut test = one_request_of_each_kind();
    let expected = [
        "2: ECANCELLED",
        "3: ECANCELLED",
        "4: ECANCELLED",
        "ECANCELLED",
    ];
    assert_eq!(shown(&test.client.cancel()), expected);
    assert!(test.is_idle() && !test.client.has_requests() && test.sent().is_empty());
    assert_eq!(shown(&test.client.cancel()), NOTHING);
    test.ask("a.test");
}

#[test]
fn close() {
    let expected = [
        "2: EDESTRUCTION",
        "3: EDESTRUCTION",
        "4: EDESTRUCTION",
        "EDESTRUCTION",
    ];
    assert_eq!(shown(&one_request_of_each_kind().client.close()), expected);
}
