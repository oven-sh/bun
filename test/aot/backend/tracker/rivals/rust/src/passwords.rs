use hmac::{Hmac, KeyInit, Mac};
use sha2::Sha256;

/// One block of PBKDF2-HMAC-SHA256: 32 bytes.
fn derive(password: &[u8], salt: &[u8], rounds: u32) -> [u8; 32] {
    let keyed = Hmac::<Sha256>::new_from_slice(password).expect("a key of any length");
    let mut mac = keyed.clone();
    mac.update(salt);
    mac.update(&1u32.to_be_bytes());
    let mut last: [u8; 32] = mac.finalize().into_bytes().into();
    let mut derived = last;
    for _ in 1..rounds {
        let mut mac = keyed.clone();
        mac.update(&last);
        last = mac.finalize().into_bytes().into();
        for (byte, next) in derived.iter_mut().zip(last) {
            *byte ^= next;
        }
    }
    derived
}

pub fn to_hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    bytes.iter().flat_map(|byte| [DIGITS[usize::from(byte >> 4)] as char, DIGITS[usize::from(byte & 15)] as char]).collect()
}

/// PBKDF2-HMAC-SHA256, 100,000 rounds. The comparison takes the same time wherever the two differ.
pub fn password_matches(password: &str, salt: &str, hash: &str) -> bool {
    let derived = to_hex(&derive(password.as_bytes(), salt.as_bytes(), 100_000));
    derived.len() == hash.len() && derived.bytes().zip(hash.bytes()).fold(0, |difference, (a, b)| difference | (a ^ b)) == 0
}

pub fn random_token(bytes: usize) -> String {
    let mut token = vec![0; bytes];
    getrandom::fill(&mut token).expect("the system's random numbers");
    to_hex(&token)
}
