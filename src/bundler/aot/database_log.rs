//! A SQLite database in write-ahead mode has its newest commits in a log beside it, which an executable doesn't have.

#[cfg(test)]
mod tests;

const HEADER_LENGTH: usize = 32;
const FRAME_HEADER_LENGTH: usize = 24;

struct Checksum {
    sums: (u32, u32),
    is_big_endian: bool,
}

impl Checksum {
    fn add(&mut self, bytes: &[u8]) {
        let (words, _) = bytes.as_chunks::<4>();
        let (pairs, _) = words.as_chunks::<2>();
        let read = |word: [u8; 4]| match self.is_big_endian {
            true => u32::from_be_bytes(word),
            false => u32::from_le_bytes(word),
        };
        let (mut first, mut second) = self.sums;
        for &[even, odd] in pairs {
            first = first.wrapping_add(read(even)).wrapping_add(second);
            second = second.wrapping_add(read(odd)).wrapping_add(first);
        }
        self.sums = (first, second);
    }

    fn is_at(&self, bytes: &[u8], at: usize) -> bool {
        read_word(bytes, at) == Some(self.sums.0) && read_word(bytes, at + 4) == Some(self.sums.1)
    }
}

fn read_word(bytes: &[u8], at: usize) -> Option<u32> {
    let word = bytes.get(at..)?.first_chunk::<4>()?;
    Some(u32::from_be_bytes(*word))
}

/// The database `contents`, the file at `path`, with what its log has committed. Returns `None` for any other file, and where the log holds nothing.
pub fn read_database_with_log(path: &[u8], contents: &[u8]) -> Option<Vec<u8>> {
    let is_in_write_ahead_mode =
        contents.starts_with(b"SQLite format 3\0") && contents.get(19) == Some(&2);
    if !is_in_write_ahead_mode {
        return None;
    }
    let log = bun_sys::File::read_from(bun_sys::Fd::cwd(), &[path, b"-wal"].concat()).ok()?;
    apply_log(contents, &log)
}

/// What a checkpoint would write.
fn apply_log(database: &[u8], log: &[u8]) -> Option<Vec<u8>> {
    let magic = read_word(log, 0)?;
    let page_size = read_word(log, 8)? as usize;
    if magic & !1 != 0x377f_0682
        || !page_size.is_power_of_two()
        || !(512..=1 << 16).contains(&page_size)
    {
        return None;
    }
    let salts = log.get(16..24)?;
    let mut checksum = Checksum {
        sums: (0, 0),
        is_big_endian: magic & 1 != 0,
    };
    checksum.add(&log[..24]);
    if !checksum.is_at(log, 24) {
        return None;
    }
    let mut frames: Vec<(usize, &[u8])> = Vec::new();
    let mut committed = None;
    let written = log.get(HEADER_LENGTH..)?;
    for frame in written.chunks_exact(FRAME_HEADER_LENGTH + page_size) {
        let (header, page) = frame.split_at(FRAME_HEADER_LENGTH);
        checksum.add(&header[..8]);
        checksum.add(page);
        // What an earlier use of the log has left.
        if header[8..16] != *salts || !checksum.is_at(header, 16) {
            break;
        }
        frames.push((read_word(header, 0)? as usize, page));
        let page_count = read_word(header, 4)? as usize;
        if page_count != 0 {
            committed = Some((frames.len(), page_count));
        }
    }
    let (frame_count, page_count) = committed?;
    // Each page was there or is in the log. A count past them is no commit of this database.
    if page_count > database.len().div_ceil(page_size) + frame_count {
        return None;
    }
    let mut database = database.to_vec();
    database.resize(page_count * page_size, 0);
    for &(number, page) in &frames[..frame_count] {
        let start = number.checked_sub(1)? * page_size;
        // A later commit may have made the database smaller.
        if let Some(place) = database.get_mut(start..start + page_size) {
            place.copy_from_slice(page);
        }
    }
    Some(database)
}
