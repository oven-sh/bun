// internal/jsnum/pseudobigint.go
use crate::jsnum::jsnum::big;
use crate::stringutil::util::strings;

// PseudoBigInt represents a JS-like bigint. The zero state of the struct represents the value 0.
#[derive(Clone, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct PseudoBigInt {
    // true if the value is a non-zero negative number.
    pub negative: bool,
    // The absolute value in base 10 with no leading zeros. The value zero is represented as an empty string.
    pub base10_value: Vec<u8>,
}

pub fn new_pseudo_big_int(value: &[u8], negative: bool) -> PseudoBigInt {
    let value = strings::trim_left(value, b"0");
    PseudoBigInt {
        negative: negative && !value.is_empty(),
        base10_value: value.to_vec(),
    }
}

impl PseudoBigInt {
    pub fn string(&self) -> Vec<u8> {
        if self.base10_value.is_empty() {
            return b"0".to_vec();
        }
        if self.negative {
            let mut result = Vec::with_capacity(self.base10_value.len() + 1);
            result.push(b'-');
            result.extend_from_slice(&self.base10_value);
            return result;
        }
        self.base10_value.clone()
    }

    pub fn sign(&self) -> isize {
        if self.base10_value.is_empty() {
            return 0;
        }
        if self.negative {
            return -1;
        }
        1
    }
}

// Err is upstream's panic: see parse_pseudo_big_int.
pub fn parse_valid_big_int(text: &[u8]) -> Result<PseudoBigInt, &'static str> {
    let (text, negative) = strings::cut_prefix(text, b"-");
    Ok(new_pseudo_big_int(&parse_pseudo_big_int(text)?, negative))
}

// Err is upstream's panic with its message: the text after a base prefix is not a number.
pub fn parse_pseudo_big_int(string_value: &[u8]) -> Result<Vec<u8>, &'static str> {
    let string_value = strings::trim_suffix(string_value, b"n");
    let b1 = string_value.get(1).copied().unwrap_or(0);
    if !matches!(b1, b'b' | b'B' | b'o' | b'O' | b'x' | b'X') {
        // Decimal.
        let string_value = strings::trim_left(string_value, b"0");
        if string_value.is_empty() {
            return Ok(b"0".to_vec());
        }
        return Ok(string_value.to_vec());
    }
    match big::Int::set_string(string_value) {
        Some(bi) => Ok(bi.string()),
        None => Err("Failed to parse big int"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stringutil::util::strings::split;

    // Replays upstream's Go code: P is the text and ParsePseudoBigInt (PANIC for its panic), V the text and the sign, the digits and the String of ParseValidBigInt.
    #[test]
    fn matches_upstream_vectors() {
        let text = include_bytes!("testdata/pseudobigint.tsv");
        let mut checked = 0;
        for line in split(text, b"\n") {
            if line.is_empty() {
                continue;
            }
            let f = split(line, b"\t");
            let shown = std::str::from_utf8(line).unwrap();
            match f[0] {
                b"P" => {
                    let got = parse_pseudo_big_int(f[1]).unwrap_or_else(|_| b"PANIC".to_vec());
                    assert_eq!(got, f[2], "{shown}");
                }
                b"V" => {
                    let got = match parse_valid_big_int(f[1]) {
                        Ok(value) => {
                            let mut got = value.sign().to_string().into_bytes();
                            got.push(b' ');
                            got.extend_from_slice(&value.base10_value);
                            got.push(b' ');
                            got.extend_from_slice(&value.string());
                            got
                        }
                        Err(_) => b"PANIC".to_vec(),
                    };
                    assert_eq!(got, f[2], "{shown}");
                }
                other => panic!("unknown vector {other:?}"),
            }
            checked += 1;
        }
        assert_eq!(checked, 96);
    }

    #[test]
    fn zero_is_never_negative() {
        assert_eq!(new_pseudo_big_int(b"000", true), PseudoBigInt::default());
        assert_eq!(new_pseudo_big_int(b"0012", true).string(), b"-12");
        assert_eq!(new_pseudo_big_int(b"0012", true).sign(), -1);
        assert_eq!(PseudoBigInt::default().string(), b"0");
    }
}
