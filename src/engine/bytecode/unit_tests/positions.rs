use super::support::Random;
use crate::{Position, Positions};

fn encode(entries: &[(u32, Position)]) -> Vec<u8> {
    let mut bytes = vec![0; Positions::max_size(entries.len())];
    let size = Positions::encode(entries, &mut bytes);
    bytes.truncate(size);
    bytes
}

fn random_entries(random: &mut Random, count: usize) -> Vec<(u32, Position)> {
    let mut offset = 0;
    let entry = |_| {
        offset += 1 + random.skewed_below(300);
        let [divot, start, end] = [(); 3].map(|()| random.skewed_below(u32::MAX));
        (offset, Position { divot, start, end })
    };
    (0..count).map(entry).collect()
}

#[test]
fn bytes_of_an_entry() {
    let position = |divot, start, end| Position { divot, start, end };
    let entries = [(0, position(200, 199, 203)), (130, position(198, 198, 198))];
    assert_eq!(encode(&entries), [0, 0, 0x90, 3, 1, 3, 0x82, 1, 3, 0, 0]);
    assert_eq!(encode(&[]), []);
}

#[test]
fn every_offset_finds_the_last_entry_up_to_it() {
    for count in [0, 1, 63, 64, 65, 128, 129, 300] {
        let entries = random_entries(&mut Random::new(count as u64), count);
        let bytes = encode(&entries);
        let positions = Positions::read(&bytes).unwrap();
        assert!(positions.is_valid(|_| true));
        assert_eq!(positions.entries().collect::<Vec<_>>(), entries);
        let first = positions.entries().next().map(|(_, position)| position);
        assert_eq!(positions.find(0), first);
        let mut previous = None;
        for &(offset, position) in &entries {
            assert_eq!(positions.find(offset - 1), previous.or(first));
            assert_eq!(positions.find(offset), Some(position));
            previous = Some(position);
        }
        assert_eq!(positions.find(u32::MAX), previous);
    }
}

#[test]
fn the_widest_entries_fit() {
    let entry = |index: u32| {
        let divot = (index % 2) << 31;
        let (start, end) = (divot.wrapping_add(1), divot.wrapping_sub(1));
        (index << 24, Position { divot, start, end })
    };
    let entries: Vec<_> = (0..200).map(entry).collect();
    let bytes = encode(&entries);
    assert!(Positions::read(&bytes).unwrap().entries().eq(entries));
}

#[test]
fn damage_is_found() {
    let entries = random_entries(&mut Random::new(1), 70);
    let bytes = encode(&entries);
    let is_valid = |bytes: &[u8]| Positions::read(bytes).is_some_and(|it| it.is_valid(|_| true));
    assert!(!is_valid(&bytes[..bytes.len() - 1]));
    assert!(!is_valid(&bytes[..5]));
    assert!(!is_valid(&[&bytes[..], &[1]].concat()));
    assert!(!is_valid(&[&[0], &bytes[13..]].concat()));
    assert!(!is_valid(&[0, 1, 0, 0, 0, 0, 0, 0, 0]));
    assert!(!is_valid(&[0xff, 0xff, 0xff, 0xff, 0x0f]));
    for in_chapter in 1..13 {
        let mut bytes = bytes.clone();
        bytes[in_chapter] ^= 1;
        assert!(!is_valid(&bytes));
    }
    let last = entries.last().unwrap().0;
    let positions = Positions::read(&bytes).unwrap();
    assert!(!positions.is_valid(|offset| offset != last));
}
