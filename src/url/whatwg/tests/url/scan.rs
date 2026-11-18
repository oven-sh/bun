use bun_highway::url::PlainBytes;

static SET: PlainBytes = PlainBytes::new(b"#A|", b"%x");

fn is_stop(before: u8, byte: u8) -> bool {
    !byte.is_ascii_graphic()
        || matches!(byte, b'#' | b'A' | b'|')
        || (matches!(byte, b'%' | b'x') && matches!(before, b'.' | b'/'))
}

#[test]
fn every_pair_of_bytes() {
    for before in 0..=255 {
        let text: Vec<u8> = (0..=255).flat_map(|byte| [before, byte]).collect();
        let expected =
            (0..text.len()).filter(|&at| is_stop(if at == 0 { 0 } else { text[at - 1] }, text[at]));
        assert!(SET.scan(&text, 0).eq(expected));
    }
}

#[test]
fn every_length_start_and_position() {
    for length in 0..150usize {
        for position in 1..length {
            let mut text = vec![b'x'; length];
            text[position - 1] = b'/';
            for start in [0, 1, position - 1, position, position + 1, length] {
                let expected = (start <= position).then_some(position);
                assert_eq!(SET.scan(&text, start).next(), expected);
                let bit = |count| match position.checked_sub(start) {
                    Some(distance) if distance < count => 1 << distance,
                    _ => 0,
                };
                assert_eq!(SET.stops_in_32(&text, start), bit(32));
                assert_eq!(SET.stops_in_64(&text, start), bit(64));
            }
        }
    }
}

#[test]
fn skipping() {
    let text = [b'#'; 200];
    for step in 1..140 {
        let mut scan = SET.resume_scan(&text, 3 + 64, SET.stops_in_64(&text, 3));
        let mut expected = 3;
        while let Some(at) = scan.next() {
            assert_eq!(at, expected);
            expected += step;
            scan.skip_to(expected);
        }
        assert!(expected >= text.len());
    }
}
