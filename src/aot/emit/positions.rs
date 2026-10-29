use crate::ir::generated::{ColumnAdjustment, SourcePositions};
use bun_core::strings::{contains, contains_char, index_of, index_of_char_pos, last_index_of};

pub fn source_positions(source: &[u8], line_starts: Vec<u32>) -> SourcePositions {
    let column_adjustments = compute_column_adjustments(source, &line_starts);
    SourcePositions {
        line_starts,
        column_adjustments,
    }
}

// A stack trace shows lines and columns of `evaluated`, which a bundler made of `source`. `corrections`: the words that reading the two texts side by side gets wrong (src/codegen/bundled-positions.ts).
pub fn source_positions_in_bundle(
    source: &[u8],
    evaluated: &[u8],
    corrections: &[u8],
) -> SourcePositions {
    let aligner = Aligner::read(Words::of(source), Words::of(evaluated), corrections);
    let mut places = Places::new(source, evaluated);
    for (number, &partner) in aligner.partners.iter().enumerate() {
        let Some(&(evaluated_start, evaluated_end)) =
            aligner.evaluated.ranges.get(partner as usize)
        else {
            continue;
        };
        let (start, end) = aligner.written.ranges[number];
        // `@name` stands for `$name`, `!0` for `true`.
        let mark_of = |text: &[u8], start: u32| text.get((start as usize).wrapping_sub(1)).copied();
        let mark = mark_of(evaluated, evaluated_start);
        let belongs_to_word = match mark {
            Some(b'@') => true,
            Some(b'!') => {
                aligner.written.spelled(number) != aligner.evaluated.spelled(partner as usize)
            }
            _ => false,
        };
        let has_mark = belongs_to_word && mark_of(source, start) != mark;
        places.add(
            start as usize,
            (evaluated_start - u32::from(has_mark)) as usize,
        );
        places.add_what_is_alike(end as usize, evaluated_end as usize);
    }
    SourcePositions {
        line_starts: Vec::new(),
        column_adjustments: places.finish(),
    }
}

const IS_WORD_BYTE: [bool; 256] = {
    let mut table = [false; 256];
    let mut byte = 0u8;
    loop {
        table[byte as usize] = byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'$';
        if byte == u8::MAX {
            break table;
        }
        byte += 1;
    }
};

fn is_word_byte(byte: u8) -> bool {
    IS_WORD_BYTE[byte as usize]
}

fn find_starts_of_lines(text: &[u8]) -> Vec<u32> {
    let mut starts = vec![0];
    let mut at = 0;
    while let Some(line_break) = index_of_char_pos(text, b'\n', at) {
        at = line_break + 1;
        starts.push(at as u32);
    }
    starts
}

fn is_space(byte: u8) -> bool {
    byte == b' ' || (9..=13).contains(&byte)
}

struct Words<'a> {
    text: &'a [u8],
    ranges: Vec<(u32, u32)>,
    // The length and the first bytes of each word as it is spelled: two words with two keys are two words.
    keys: Vec<u32>,
}

impl<'a> Words<'a> {
    fn of(text: &'a [u8]) -> Self {
        let mut words = Words {
            text,
            ranges: Vec::with_capacity(text.len() / 8),
            keys: Vec::with_capacity(text.len() / 8),
        };
        let mut at = 0;
        while at < text.len() {
            if !is_word_byte(text[at]) {
                at += 1;
                continue;
            }
            let start = at;
            while at < text.len() && is_word_byte(text[at]) {
                at += 1;
            }
            words.ranges.push((start as u32, at as u32));
            let spelled = start + usize::from(text[start] == b'$');
            let byte_at = |index: usize| match index < at {
                true => u32::from(text[index]),
                false => 0,
            };
            let first_bytes =
                byte_at(spelled) << 16 | byte_at(spelled + 1) << 8 | byte_at(spelled + 2);
            words.keys.push(((at - spelled) as u32) << 24 | first_bytes);
        }
        words
    }

    fn len(&self) -> usize {
        self.ranges.len()
    }

    fn spelled(&self, number: usize) -> &'a [u8] {
        let (start, end) = self.ranges[number];
        let word = &self.text[start as usize..end as usize];
        word.strip_prefix(b"$").unwrap_or(word)
    }
}

const NO_PARTNER: u32 = u32::MAX;
const FARTHEST_LOOK_AHEAD: usize = 8;
const WORDS_REMEMBERED: usize = 8;

// The same steps, in the same order, as `Aligner` of src/codegen/bundled-positions.ts.
struct Aligner<'a> {
    written: Words<'a>,
    evaluated: Words<'a>,
    next_written: usize,
    next_evaluated: usize,
    passed_over: Vec<u32>,
    partners: Vec<u32>,
}

impl<'a> Aligner<'a> {
    fn read(written: Words<'a>, evaluated: Words<'a>, corrections: &[u8]) -> Self {
        let mut bytes = corrections.iter();
        let mut read_number = || {
            let mut value = 0u32;
            for shift in (0..32).step_by(7) {
                let byte = *bytes.next()?;
                value |= u32::from(byte & 0x7F) << shift;
                if byte & 0x80 == 0 {
                    return Some(value as usize);
                }
            }
            None
        };
        let mut aligner = Aligner {
            partners: vec![NO_PARTNER; written.len()],
            written,
            evaluated,
            next_written: 0,
            next_evaluated: 0,
            passed_over: Vec::new(),
        };
        let mut corrected = read_number();
        while aligner.next_written < aligner.written.len() {
            if corrected != Some(aligner.next_written) {
                let stop = corrected.unwrap_or(usize::MAX);
                aligner.step(stop.min(aligner.written.len()));
                continue;
            }
            match read_number() {
                None | Some(0) => aligner.next_written += 1,
                Some(distance) => {
                    let distance = distance - 1;
                    aligner.next_evaluated = match distance & 1 {
                        0 => aligner.next_evaluated.wrapping_add(distance >> 1),
                        _ => aligner.next_evaluated.wrapping_sub((distance >> 1) + 1),
                    };
                    aligner.pair_next_words();
                }
            }
            let next = aligner.next_written;
            corrected = read_number().map(|distance| next.saturating_add(distance.max(1) - 1));
        }
        aligner
    }

    fn pair_next_words(&mut self) {
        if self.next_evaluated < self.evaluated.len() {
            self.partners[self.next_written] = self.next_evaluated as u32;
        }
        self.next_written += 1;
        self.next_evaluated = self.next_evaluated.wrapping_add(1);
    }

    fn is_alike(&self, written: usize, evaluated: usize) -> bool {
        self.written.keys[written] == self.evaluated.keys[evaluated]
            && self.written.spelled(written) == self.evaluated.spelled(evaluated)
    }

    fn find_end_of_comment(&self) -> Option<usize> {
        let text = self.written.text;
        let start = self.written.ranges[self.next_written].0 as usize;
        let end_of_last_word = match self.next_written {
            0 => 0,
            number => self.written.ranges[number - 1].1 as usize,
        };
        let gap = &text[end_of_last_word..start];
        let find_behind_word = |end: &[u8]| index_of(&text[start..], end).map(|at| start + at);
        if last_index_of(gap, b"//").is_some_and(|line| !contains_char(&gap[line..], b'\n')) {
            return find_behind_word(b"\n");
        }
        if last_index_of(gap, b"/*").is_some_and(|block| !contains(&gap[block..], b"*/")) {
            return find_behind_word(b"*/");
        }
        None
    }

    // Decides on one or more words of `written`, none of them at or behind `stop`, which is behind `next_written`.
    fn step(&mut self, stop: usize) {
        let (i, j) = (self.next_written, self.next_evaluated);
        let (written_len, evaluated_len) = (self.written.len(), self.evaluated.len());
        if j < evaluated_len && self.is_alike(i, j) {
            return self.pair_next_words();
        }
        if let Some(end) = self.find_end_of_comment() {
            let is_in_comment = |range: &(u32, u32)| (range.0 as usize) < end;
            let words = self.written.ranges[i..stop].iter();
            self.next_written += words.take_while(|range| is_in_comment(range)).count();
            return;
        }
        let find = || {
            for distance in 1..=FARTHEST_LOOK_AHEAD {
                for skipped in (0..=distance.min(written_len - i)).rev() {
                    let (x, y) = (i + skipped, j.wrapping_add(distance - skipped));
                    let is_found = match x < written_len && y < evaluated_len {
                        true => self.is_alike(x, y),
                        false => x >= written_len && y >= evaluated_len,
                    };
                    if is_found {
                        return (skipped, distance - skipped, x < written_len);
                    }
                }
            }
            (1, 1, false)
        };
        let (skipped, skipped_of_evaluated, is_found) = find();
        // Of more words of `written` the first ones say a type; of more words of `evaluated` the last ones were put in.
        let replaced = skipped.min(skipped_of_evaluated);
        let left_out = skipped - replaced;
        for k in 0..skipped {
            if i + k >= stop {
                return;
            }
            if k >= left_out {
                self.pair_next_words();
                continue;
            }
            self.next_written += 1;
            let word = self.written.spelled(i + k);
            let evaluated = &self.evaluated;
            let mut passed_over = self.passed_over.iter();
            if let Some(moved) =
                passed_over.rposition(|&number| evaluated.spelled(number as usize) == word)
            {
                self.partners[i + k] = self.passed_over.remove(moved);
            }
        }
        let passed_over = (replaced..skipped_of_evaluated).map(|k| j.wrapping_add(k));
        self.passed_over.extend(
            passed_over
                .filter(|&number| number < evaluated_len)
                .map(|number| number as u32),
        );
        let forgotten = self.passed_over.len().saturating_sub(WORDS_REMEMBERED);
        self.passed_over.drain(..forgotten);
        self.next_evaluated = j.wrapping_add(skipped_of_evaluated);
        if is_found && self.next_written < stop {
            self.pair_next_words();
        }
    }
}

struct Places<'a> {
    written: &'a [u8],
    evaluated: &'a [u8],
    line_starts_of_written: Vec<u32>,
    lines_of_written_passed: usize,
    next_line_start_of_written: usize,
    line_starts: Vec<u32>,
    adjustments: Vec<ColumnAdjustment>,
    last: ColumnAdjustment,
    // Where `last` stands in `evaluated`, and where its line ends there: 0 behind a line break of `written`, where nobody has looked.
    last_in_evaluated: usize,
    end_of_line: usize,
    // Where the last token ends: the place of what follows it, unless that has a place of its own.
    end: Option<(usize, usize)>,
}

impl<'a> Places<'a> {
    fn new(written: &'a [u8], evaluated: &'a [u8]) -> Self {
        let mut places = Places {
            written,
            evaluated,
            line_starts_of_written: find_starts_of_lines(written),
            lines_of_written_passed: 0,
            next_line_start_of_written: 0,
            line_starts: find_starts_of_lines(evaluated),
            adjustments: Vec::new(),
            last: ColumnAdjustment {
                offset: 0,
                line: 0,
                column: 0,
            },
            last_in_evaluated: 0,
            end_of_line: 0,
            end: None,
        };
        places.pass_line_of_written();
        places
    }

    fn pass_line_of_written(&mut self) {
        self.lines_of_written_passed += 1;
        let next = self
            .line_starts_of_written
            .get(self.lines_of_written_passed);
        self.next_line_start_of_written = next.map_or(usize::MAX, |&start| start as usize);
    }

    // What stands alike in both texts goes on over line breaks.
    fn scan_to(&mut self, offset: usize) {
        while self.next_line_start_of_written <= offset {
            self.last = ColumnAdjustment {
                offset: self.next_line_start_of_written as u32,
                line: self.last.line.wrapping_add(1),
                column: 0,
            };
            self.end_of_line = 0;
            self.adjustments.push(self.last);
            self.pass_line_of_written();
        }
    }

    #[inline]
    fn adjust(&mut self, offset: usize, evaluated_index: usize) {
        let distance = offset.wrapping_sub(self.last.offset as usize);
        let goes_on_alike = offset < self.next_line_start_of_written
            && evaluated_index < self.end_of_line
            && evaluated_index == self.last_in_evaluated.wrapping_add(distance);
        if !goes_on_alike {
            self.adjust_where_nothing_goes_on(offset, evaluated_index);
        }
    }

    fn adjust_where_nothing_goes_on(&mut self, offset: usize, evaluated_index: usize) {
        self.scan_to(offset);
        let next_line = self
            .line_starts
            .partition_point(|&start| start as usize <= evaluated_index);
        let place = ColumnAdjustment {
            offset: offset as u32,
            line: next_line as u32 - 1,
            column: evaluated_index as u32 - self.line_starts[next_line - 1],
        };
        let end_of_line = self.line_starts.get(next_line);
        self.end_of_line = end_of_line.map_or(usize::MAX, |&start| start as usize);
        self.last_in_evaluated = evaluated_index;
        let distance = place.offset.wrapping_sub(self.last.offset);
        let column = self.last.column.wrapping_add(distance);
        let is_as_expected = (self.last.line, column) == (place.line, place.column);
        self.last = place;
        if is_as_expected && !self.adjustments.is_empty() {
            return;
        }
        self.adjustments
            .pop_if(|previous| previous.offset == place.offset);
        self.adjustments.push(place);
    }

    fn add(&mut self, offset: usize, evaluated_index: usize) {
        if let Some((end, evaluated_end)) = self.end.take().filter(|end| end.0 < offset) {
            self.adjust(end, evaluated_end);
        }
        self.adjust(offset, evaluated_index);
    }

    // What stands between a word and the next one is alike in both texts but for spaces and for what only says a type.
    fn add_what_is_alike(&mut self, mut offset: usize, mut evaluated_index: usize) {
        let skip_spaces = |text: &[u8], at: usize| {
            at + text[at..]
                .iter()
                .take_while(|byte| is_space(**byte))
                .count()
        };
        let (written, evaluated) = (self.written, self.evaluated);
        self.end = Some((offset, evaluated_index));
        loop {
            offset = skip_spaces(written, offset);
            evaluated_index = skip_spaces(evaluated, evaluated_index);
            match written[offset..] {
                [] | [b'/', b'/' | b'*', ..] => break,
                [byte, ..] if is_word_byte(byte) => break,
                [byte, ..] if evaluated.get(evaluated_index) == Some(&byte) => {
                    self.add(offset, evaluated_index);
                    offset += 1;
                    evaluated_index += 1;
                    self.end = Some((offset, evaluated_index));
                }
                [b'!', b'=', ..] => break,
                [b'!', ..] => offset += 1,
                _ => break,
            }
        }
    }

    fn finish(mut self) -> Vec<ColumnAdjustment> {
        if let Some((end, evaluated_end)) = self.end.take() {
            self.adjust(end, evaluated_end);
        }
        self.scan_to(self.written.len());
        self.adjustments
    }
}

fn compute_column_adjustments(source: &[u8], line_starts: &[u32]) -> Vec<ColumnAdjustment> {
    let mut adjustments = Vec::new();
    if source.is_ascii() {
        return adjustments;
    }
    for (line, &start) in line_starts.iter().enumerate() {
        let end = line_starts
            .get(line + 1)
            .map_or(source.len(), |&next| next as usize);
        let line_text = &source[start as usize..end];
        if line_text.is_ascii() {
            continue;
        }
        let mut at = 0;
        let mut line_excess_bytes = 0;
        while at < line_text.len() {
            let (length, excess_bytes) = match line_text[at] {
                0x00..=0xBF => {
                    at += 1;
                    continue;
                }
                0xC0..=0xDF => (2, 1),
                0xE0..=0xEF => (3, 2),
                0xF0..=0xFF => (4, 2),
            };
            at = (at + length).min(line_text.len());
            line_excess_bytes += excess_bytes;
            adjustments.push(ColumnAdjustment {
                offset: start + at as u32,
                line: line as u32,
                column: (at as u32).saturating_sub(line_excess_bytes),
            });
        }
    }
    adjustments
}
