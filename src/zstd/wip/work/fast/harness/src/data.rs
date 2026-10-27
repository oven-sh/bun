//! Deterministic inputs.
pub struct Rng(pub u64);
impl Rng {
    pub fn next(&mut self) -> u64 {
        // splitmix64
        self.0 = self.0.wrapping_add(0x9E3779B97F4A7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
        z ^ (z >> 31)
    }
    pub fn below(&mut self, n: usize) -> usize { if n == 0 { 0 } else { (self.next() % n as u64) as usize } }
    pub fn range(&mut self, lo: usize, hi: usize) -> usize { lo + self.below(hi - lo + 1) }
    pub fn chance(&mut self, num: usize, den: usize) -> bool { self.below(den) < num }
    pub fn pick<'a, T>(&mut self, v: &'a [T]) -> &'a T { &v[self.below(v.len())] }
    /// Skewed towards small values.
    pub fn size(&mut self, max: usize) -> usize {
        let bits = self.below(usize::BITS as usize - max.leading_zeros() as usize + 1);
        (self.next() as usize & ((1usize << bits) - 1)).min(max)
    }
}

static WORDS: &[&str] = &["the ", "function ", "return ", "const ", "bun", "zstd", "\n", "  ", "{", "}", "(", ");", "import ", "export ", "0", "1", "===", "await ", "async ", "null", "undefined", "\"use strict\";", "=> ", "let ", "for ", "if ", "else ", "this.", "length", "// "];

/// One buffer of about `len` bytes, of a kind picked by `rng`.
pub fn data(rng: &mut Rng, len: usize) -> Vec<u8> {
    let mut v = Vec::with_capacity(len + 64);
    match rng.below(9) {
        0 => v.resize(len, rng.next() as u8),
        1 => while v.len() < len { v.push(rng.next() as u8) },
        2 => while v.len() < len { v.extend_from_slice(rng.pick(WORDS).as_bytes()) },
        3 => { // few symbols, skewed
            let n = rng.range(2, 40);
            while v.len() < len { let a = rng.below(n); let b = rng.below(n); v.push(b'a' + a.min(b) as u8) }
        }
        4 => { // LZ-like: copies of earlier parts, at all distances
            while v.len() < len {
                if v.len() > 8 && rng.chance(3, 4) {
                    let dist = 1 + rng.size(v.len() - 1);
                    let n = 3 + rng.size(300);
                    for _ in 0..n { let b = v[v.len() - dist]; v.push(b) }
                } else {
                    for _ in 0..1 + rng.size(40) { v.push(rng.next() as u8) }
                }
            }
        }
        5 => { // periodic with noise
            let period = rng.range(1, 300);
            let pat: Vec<u8> = (0..period).map(|_| rng.next() as u8).collect();
            while v.len() < len { let b = pat[v.len() % period]; v.push(if rng.chance(1, 200) { rng.next() as u8 } else { b }) }
        }
        6 => { // sections of different kinds
            while v.len() < len { let n = 1 + rng.size(len.max(1)); let part = data(rng, n.min(len - v.len() + 1)); v.extend_from_slice(&part) }
        }
        7 => { // numbers as text
            let mut x = rng.next() % 1000;
            while v.len() < len { x = x.wrapping_add(rng.next() % 17); v.extend_from_slice(format!("{x},").as_bytes()) }
        }
        _ => { // long runs
            while v.len() < len { let b = rng.next() as u8; let n = 1 + rng.size(5000); v.resize(v.len() + n, b) }
        }
    }
    v.truncate(len);
    v
}
