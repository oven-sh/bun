// Scratch check of the planned `to_precision`: exact digits from core's `{:.766e}`, rounded half up.
use std::fmt::Write;
use std::io::BufRead;

fn to_precision(value: f64, precision: usize, buf: &mut String) -> Option<(Vec<u8>, i32)> {
    buf.clear();
    write!(buf, "{:.766e}", value).ok()?;
    let (mantissa, exponent) = buf.split_once('e')?;
    let mut exponent: i32 = exponent.parse().ok()?;
    let mut digits = mantissa.bytes().filter(|b| *b != b'.');
    let mut head: Vec<u8> = digits.by_ref().take(precision).collect();
    if digits.next()? >= b'5' {
        let mut i = head.len();
        loop {
            if i == 0 {
                head.insert(0, b'1');
                head.pop();
                exponent += 1;
                break;
            }
            i -= 1;
            if head[i] == b'9' {
                head[i] = b'0';
            } else {
                head[i] += 1;
                break;
            }
        }
    }
    Some((head, exponent))
}

fn main() {
    // stdin lines: "<bits as hex u64> <precision> <coefficient> <magnitude>" produced by node with the engine's toPrecision
    let stdin = std::io::stdin();
    let mut buf = String::new();
    let (mut n, mut bad) = (0u64, 0u64);
    let start = std::time::Instant::now();
    for line in stdin.lock().lines() {
        let line = line.unwrap();
        let mut it = line.split(' ');
        let bits = u64::from_str_radix(it.next().unwrap(), 16).unwrap();
        let p: usize = it.next().unwrap().parse().unwrap();
        let coefficient = it.next().unwrap();
        let magnitude: i32 = it.next().unwrap().parse().unwrap();
        let value = f64::from_bits(bits);
        let (digits, exponent) = to_precision(value, p, &mut buf).unwrap();
        n += 1;
        if digits != coefficient.as_bytes() || exponent != magnitude {
            bad += 1;
            if bad < 10 {
                println!("DIFF {value:e} p={p} js=({coefficient},{magnitude}) rs=({},{exponent})", String::from_utf8_lossy(&digits));
            }
        }
    }
    println!("compared {n} differences {bad} in {:?}", start.elapsed());
}
