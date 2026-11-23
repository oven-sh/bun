//! The filters for all targets against plain loops, and memory that is refused at a given point.

use bun_png::{Decoder, Error, Palette, Result, encode};
use bun_simd::target::{Target, reset_cpu, set_cpu};
use bun_zlib::{Inflater, deflate, inflate};
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

thread_local! {
    /// How many allocations are granted before one is refused.
    static GRANTS: Cell<Option<usize>> = const { Cell::new(None) };
}

struct Refusing;

// SAFETY: what is not refused is left to `System`.
unsafe impl GlobalAlloc for Refusing {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let grants = GRANTS.get();
        GRANTS.set(grants.and_then(|it| it.checked_sub(1)));
        if grants == Some(0) {
            return std::ptr::null_mut();
        }
        // SAFETY: the caller's promises are passed on.
        unsafe { System.alloc(layout) }
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        // SAFETY: as above.
        unsafe { System.dealloc(pointer, layout) }
    }
}

#[global_allocator]
static ALLOCATOR: Refusing = Refusing;

struct Noise(u32);

impl Noise {
    fn byte(&mut self) -> u8 {
        self.0 = self.0.wrapping_mul(1664525).wrapping_add(1013904223);
        (self.0 >> 24) as u8
    }

    /// In which one pixel of `run` differs from the one before it.
    fn row(&mut self, width: usize, step: usize, run: u8) -> Vec<u8> {
        let mut row: Vec<u8> = Vec::new();
        for x in 0..width {
            if x == 0 || self.byte().is_multiple_of(run) {
                row.extend((0..step).map(|_| self.byte()));
            } else {
                row.extend_from_within(row.len() - step..);
            }
        }
        row
    }
}

fn filtered(filter_type: u8, step: usize, row: &[u8], above: &[u8]) -> Vec<u8> {
    let left = |row: &[u8], at: usize| at.checked_sub(step).map_or(0, |at| row[at]);
    let bytes = (0..row.len()).map(|at| {
        let [a, b, c] = [left(row, at), above[at], left(above, at)].map(i32::from);
        let nearest = [a, b, c]
            .into_iter()
            .min_by_key(|it| (a + b - c - it).abs());
        let predicted = [0, a, b, (a + b) / 2, nearest.unwrap(), 0];
        row[at].wrapping_sub(predicted[usize::from(filter_type)] as u8)
    });
    [filter_type].into_iter().chain(bytes).collect()
}

#[derive(Clone, Copy, Debug)]
struct Format {
    color_type: u8,
    bytes: usize,
    has_transparency: bool,
}

impl Format {
    const RGBA: Self = Self {
        color_type: 6,
        bytes: 1,
        has_transparency: false,
    };

    fn all() -> impl Iterator<Item = Self> {
        let all = (0..4 * 7).map(|i| Self {
            color_type: i / 4,
            bytes: usize::from(1 + i % 2),
            has_transparency: i / 2 % 2 == 1,
        });
        all.filter(|it| match it.color_type {
            0 | 2 => true,
            3 => it.bytes == 1,
            4 | 6 => !it.has_transparency,
            _ => false,
        })
    }

    fn step(self) -> usize {
        self.bytes * [1, 0, 3, 1, 2, 0, 4][usize::from(self.color_type)]
    }

    /// What is zero is transparent.
    fn rgba(self, pixel: &[u8]) -> [u8; 4] {
        let sample = |i: usize| pixel[i * self.bytes];
        let is_clear = self.has_transparency && pixel.iter().all(|&it| it == 0);
        let alpha = if is_clear { 0 } else { 255 };
        match self.color_type {
            2 => [sample(0), sample(1), sample(2), alpha],
            4 => [sample(0), sample(0), sample(0), sample(1)],
            6 => [sample(0), sample(1), sample(2), sample(3)],
            _ => [sample(0), sample(0), sample(0), alpha],
        }
    }

    fn file(self, width: usize, height: usize, interlace: u8, lines: &[u8]) -> Vec<u8> {
        let mut header = b"IHDR".to_vec();
        header.extend([width, height].map(|it| (it as u32).to_be_bytes()).concat());
        header.extend([8 * self.bytes as u8, self.color_type, 0, 0, interlace]);
        let mut chunks = vec![header];
        if self.color_type == 3 {
            let grays = (0..=255).flat_map(|it| [it; 3]);
            chunks.push(b"PLTE".iter().copied().chain(grays).collect());
        }
        if self.has_transparency {
            let len = [2, 0, 6, 1][usize::from(self.color_type)];
            chunks.push(b"tRNS\0\0\0\0\0\0"[..4 + len].to_vec());
        }
        let (mut idat, options) = (b"IDAT".to_vec(), deflate::Options::default());
        deflate::compress(lines, &mut idat, deflate::Container::Zlib, options).unwrap();
        chunks.extend([idat, b"IEND".to_vec()]);
        let mut file = b"\x89PNG\r\n\x1a\n".to_vec();
        for chunk in chunks {
            file.extend((chunk.len() as u32 - 4).to_be_bytes());
            file.extend(&chunk);
            file.extend(bun_hash::crc32(0, &chunk).to_be_bytes());
        }
        file
    }

    /// A file, and what becomes of it.
    fn case(self, width: usize, types: &[u8], run: u8) -> (Vec<u8>, Result<Vec<u8>>) {
        let (step, mut noise) = (self.step(), Noise(width as u32));
        let (mut above, mut lines, mut rgba) = (vec![0; width * step], vec![], vec![]);
        for &filter_type in types {
            let mut row = noise.row(width, step, run);
            row[usize::from(noise.byte()) % width * step..][..step].fill(0);
            lines.extend(filtered(filter_type, step, &row, &above));
            rgba.extend(row.chunks(step).flat_map(|pixel| self.rgba(pixel)));
            above = row;
        }
        let is_valid = types.iter().all(|&it| it < 5);
        let rgba = is_valid.then_some(rgba).ok_or(Error::InvalidFilterType);
        (self.file(width, types.len(), 0, &lines), rgba)
    }

    /// The same in seven passes, none of which is empty.
    fn interlaced(self, width: usize, height: usize) -> (Vec<u8>, Result<Vec<u8>>) {
        let (step, mut lines) = (self.step(), vec![]);
        let pixels = Noise(1).row(width * height, step, 3);
        let starts = [(0, 0), (4, 0), (0, 4), (2, 0), (0, 2), (1, 0), (0, 1)];
        for (pass, (x, y)) in starts.into_iter().enumerate() {
            let (across, down) = (8 >> (pass / 2), 8 >> (pass.saturating_sub(1) / 2));
            for row in pixels.chunks(width * step).skip(y).step_by(down) {
                lines.push(0);
                lines.extend(row.chunks(step).skip(x).step_by(across).flatten());
            }
        }
        let rgba = pixels.chunks(step).flat_map(|pixel| self.rgba(pixel));
        (self.file(width, height, 1, &lines), Ok(rgba.collect()))
    }
}

fn decode(file: &[u8]) -> Result<Vec<u8>> {
    Ok(Decoder::new(file)?.decode()?.rgba)
}

fn files() -> Vec<(Vec<u8>, Result<Vec<u8>>)> {
    let mut files = Vec::new();
    for format in Format::all() {
        for width in (1..40).chain([63, 64, 65, 150, 333]) {
            for run in [1, 30] {
                files.push(format.case(width, &[4, 4, 3, 4, 1, 4, 2, 0, 3, 4, 4], run));
            }
        }
        // What is missing shows before what is wrong.
        files.push((format.file(1, 9, 0, &[5; 10]), Err(Error::IdatTooShort)));
        // The stream ends at the first chunk of another type.
        let mut file = format.case(3, &[0; 2], 1).0;
        let at = file.array_windows().position(|it| it == b"IDAT").unwrap() - 4;
        file.splice(at..at, *b"\0\0\0\0IDAT....\0\0\0\0abCd....");
        files.push((file, Err(Error::IdatTooShort)));
        // Lines that are longer than what is inflated at a time.
        files.push(format.case(140_000 / format.step(), &[1, 4, 3], 200));
        // Lines that end with it, or reach over its end.
        for width in [1, 2, 21, 63, 100] {
            let height = 132_000 / (1 + width * format.step());
            files.push(format.case(width, &vec![2; height], 1));
        }
        // Only the first passes have short lines.
        for row_bytes in [40, 70_000, 140_000] {
            files.push(format.interlaced(row_bytes / format.step(), 5));
        }
    }
    for height in 1..19 {
        files.push(Format::RGBA.case(64, &[4; 19][..height], 1));
    }
    // One row among Paeth's has another type.
    for (at, other) in (0..19).flat_map(|at| [0, 1, 2, 3, 5].map(|other| (at, other))) {
        let mut types = [4; 19];
        types[at] = other;
        files.push(Format::RGBA.case(64 + at, &types, 1));
    }
    files
}

/// An image, its width, and the lines with the first of the best filters.
fn images() -> Vec<(Vec<u8>, u32, Vec<u8>)> {
    let image = |(width, mask): (usize, u8)| {
        let mut noise = Noise(width as u32);
        let (mut above, mut lines, mut rgba) = (vec![0; 4 * width], vec![], vec![]);
        for y in 0..40 {
            let mut row = noise.row(width, 4, 1 + y % 3);
            row.iter_mut().for_each(|it| *it &= mask);
            let all = (0..5).map(|it| filtered(it, 4, &row, &above));
            let distance = |&it: &u8| u32::from((it as i8).unsigned_abs());
            let best = all.min_by_key(|it| it[1..].iter().map(distance).sum::<u32>());
            lines.extend(best.unwrap());
            rgba.extend(&row);
            above = row;
        }
        (rgba, width as u32, lines)
    };
    let sizes = (1..36).flat_map(|width| [255, 0x83, 1].map(|mask| (width, mask)));
    sizes.map(image).collect()
}

#[test]
fn all_targets_agree_with_the_models() {
    let (files, images) = (files(), images());
    for &target in Target::ALL {
        if !set_cpu(target) {
            continue;
        }
        for (i, (file, rgba)) in files.iter().enumerate() {
            assert!(decode(file) == *rgba, "{target:?} {i}");
        }
        for (rgba, width, lines) in &images {
            let file = encode(rgba, *width, 40, None, 1, None).unwrap();
            let (mut idat, mut found) = (&file[8 + 25 + 8..], Vec::new());
            let status = Inflater::new(inflate::Container::Zlib).inflate_to_vec(
                &mut idat,
                &mut found,
                usize::MAX,
            );
            assert_eq!(status, Ok(inflate::Status::StreamEnd));
            assert!(found == *lines, "{target:?} {width}");
        }
    }
    reset_cpu();
}

fn refuse_each_allocation(run: impl Fn() -> Result<Vec<u8>>) {
    let granted = run();
    assert!(granted.is_ok());
    for grants in 0.. {
        GRANTS.set(Some(grants));
        let result = run();
        if GRANTS.take().is_some() {
            break;
        }
        assert!(result == granted || matches!(result, Err(Error::Alloc(_))));
    }
}

#[test]
fn a_refusal_is_an_error() {
    for format in Format::all() {
        for (width, height, interlace) in
            [(70, 12, 0), (900, 1, 0), (71, 12, 1), (1, 1, 1), (3, 40, 1)]
        {
            let file = format.file(width, height, interlace, &[0; 8000]);
            refuse_each_allocation(|| decode(&file));
        }
        for (row_bytes, interlace) in [(20_000, 0), (20_000, 1), (70_000, 0), (70_000, 1)] {
            let file = format.file(row_bytes / format.step(), 9, interlace, &vec![0; 640_000]);
            refuse_each_allocation(|| decode(&file));
        }
    }
    let palette = Palette {
        colors: &[[1; 4]; 256],
        has_alpha: true,
    };
    let noise = Noise(1).row(40_000, 1, 1);
    refuse_each_allocation(|| encode(&noise, 100, 100, None, 1, None));
    // The first chunk of pixels ends around the end of the room that the file starts with.
    for profile in (7030..7090).map(|len| Some(&noise[..len])) {
        refuse_each_allocation(|| encode(&noise, 40_000, 1, Some(&palette), 0, profile));
    }
}
