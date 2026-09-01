use bun_core::String as BunString;
use bun_jsc::rare_data::Cuid2State;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc};
use sha3::{Digest, Sha3_512};

const DEFAULT_LENGTH: u8 = 24;
const MIN_LENGTH: i128 = 2;
const MAX_LENGTH: usize = 32;
const INITIAL_COUNT_MAX: u32 = 476_782_367;
const FINGERPRINT_LENGTH: usize = 32;
const U64_BASE36_LENGTH: usize = 13;
const SHA3_512_BASE36_LENGTH: usize = 100;
const BASE36_CHUNK_DIGITS: usize = 6;
const BASE36_CHUNK_RADIX: u64 = 2_176_782_336; // 36^6
const BASE36_CHUNK_DIVISOR: u32 = 60_466_176; // 36^5
const STATE_ENTROPY_LENGTH: usize = (FINGERPRINT_LENGTH + 1) * size_of::<u32>();
const SALT_ENTROPY_LENGTH: usize = MAX_LENGTH * size_of::<u32>();
const HASH_INPUT_LENGTH: usize = U64_BASE36_LENGTH * 2 + MAX_LENGTH + FINGERPRINT_LENGTH;
const BASE36: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";

#[inline]
fn scale_random_word(word: u32, range: u32) -> usize {
    // This is exactly floor((word / 2^32) * range), which matches CUID2's
    // Uint32-backed random function without going through floating point.
    ((u64::from(word) * u64::from(range)) >> 32) as usize
}

#[inline]
fn word_from_bytes(bytes: &[u8]) -> u32 {
    u32::from_ne_bytes(bytes.try_into().expect("infallible: size matches"))
}

/// Encode a big-endian integer as unpadded lowercase Base36.
fn big_endian_base36(input: &[u8], output: &mut [u8; SHA3_512_BASE36_LENGTH]) -> usize {
    debug_assert_eq!(input.len(), 64);

    // Divide the 512-bit big-endian value into Base36^6 chunks. Six digits
    // fit in u32, reducing this conversion from thousands of single-digit
    // divisions to at most 17 passes over 16 native limbs.
    let mut limbs = [0u32; 16];
    for (limb, bytes) in limbs.iter_mut().zip(input.chunks_exact(size_of::<u32>())) {
        *limb = u32::from_be_bytes(bytes.try_into().expect("infallible: size matches"));
    }

    let mut first_limb = limbs
        .iter()
        .position(|&limb| limb != 0)
        .unwrap_or(limbs.len());
    if first_limb == limbs.len() {
        output[0] = b'0';
        return 1;
    }

    let mut chunks = [0u32; 17];
    let mut chunks_len = 0;
    while first_limb < limbs.len() {
        let mut remainder = 0u64;
        for limb in &mut limbs[first_limb..] {
            let dividend = (remainder << 32) | u64::from(*limb);
            let quotient = dividend / BASE36_CHUNK_RADIX;
            remainder = dividend - quotient * BASE36_CHUNK_RADIX;
            *limb = quotient as u32;
        }
        chunks[chunks_len] = remainder as u32;
        chunks_len += 1;
        while first_limb < limbs.len() && limbs[first_limb] == 0 {
            first_limb += 1;
        }
    }

    let mut output_len = 0;
    let most_significant = chunks[chunks_len - 1];
    let mut divisor = 1u32;
    while divisor <= most_significant / 36 {
        divisor *= 36;
    }
    while divisor > 0 {
        output[output_len] = BASE36[((most_significant / divisor) % 36) as usize];
        output_len += 1;
        divisor /= 36;
    }

    for &chunk in chunks[..chunks_len - 1].iter().rev() {
        let mut divisor = BASE36_CHUNK_DIVISOR;
        for _ in 0..BASE36_CHUNK_DIGITS {
            output[output_len] = BASE36[((chunk / divisor) % 36) as usize];
            output_len += 1;
            divisor /= 36;
        }
    }

    output_len
}

fn sha3_base36(input: &[u8], output: &mut [u8; SHA3_512_BASE36_LENGTH]) -> usize {
    let digest = Sha3_512::digest(input);
    big_endian_base36(&digest, output)
}

fn state_from_entropy(entropy: &[u8; STATE_ENTROPY_LENGTH]) -> Option<Cuid2State> {
    let counter = scale_random_word(word_from_bytes(&entropy[..4]), INITIAL_COUNT_MAX) as u64;
    let mut fingerprint_source = [0u8; FINGERPRINT_LENGTH];

    for (destination, bytes) in fingerprint_source
        .iter_mut()
        .zip(entropy[4..].chunks_exact(size_of::<u32>()))
    {
        *destination = BASE36[scale_random_word(word_from_bytes(bytes), 36)];
    }

    let mut encoded = [0u8; SHA3_512_BASE36_LENGTH];
    let encoded_len = sha3_base36(&fingerprint_source, &mut encoded);
    if encoded_len < FINGERPRINT_LENGTH + 1 {
        // CUID2 does not pad its Base36 hash. This is astronomically unlikely
        // for SHA3-512, but reseeding avoids creating a short fingerprint.
        return None;
    }

    let mut fingerprint = [0u8; FINGERPRINT_LENGTH];
    // CUID2's hash helper drops the first Base36 digit to reduce histogram bias.
    fingerprint.copy_from_slice(&encoded[1..FINGERPRINT_LENGTH + 1]);
    Some(Cuid2State::new(fingerprint, counter))
}

fn reseed_state(global: &JSGlobalObject) {
    let state = loop {
        let mut entropy = [0u8; STATE_ENTROPY_LENGTH];
        entropy.copy_from_slice(
            global
                .bun_vm()
                .as_mut()
                .rare_data()
                .entropy_slice(STATE_ENTROPY_LENGTH),
        );
        if let Some(state) = state_from_entropy(&entropy) {
            break state;
        }
    };
    *global.bun_vm().as_mut().rare_data().cuid2_state_slot() = Some(state);
}

fn ensure_state(global: &JSGlobalObject) {
    if global
        .bun_vm()
        .as_mut()
        .rare_data()
        .cuid2_state_slot()
        .is_none()
    {
        reseed_state(global);
    }
}

fn next_state(global: &JSGlobalObject) -> ([u8; FINGERPRINT_LENGTH], u64) {
    loop {
        // SAFETY: `bun_vm()` never returns null for a Bun-owned global. Calls
        // into this host function are VM-thread-affine, so the state needs no
        // lock or atomic counter.
        ensure_state(global);
        let next = global
            .bun_vm()
            .as_mut()
            .rare_data()
            .cuid2_state_slot()
            .as_mut()
            .and_then(Cuid2State::next);
        if let Some(next) = next {
            return next;
        }
        *global.bun_vm().as_mut().rare_data().cuid2_state_slot() = None;
    }
}

fn random_letter(global: &JSGlobalObject) -> u8 {
    let word = word_from_bytes(
        global
            .bun_vm()
            .as_mut()
            .rare_data()
            .entropy_slice(size_of::<u32>()),
    );
    b'a' + scale_random_word(word, 26) as u8
}

fn u64_base36(mut value: u64, output: &mut [u8; U64_BASE36_LENGTH]) -> &[u8] {
    let mut index = output.len();
    loop {
        index -= 1;
        output[index] = BASE36[(value % 36) as usize];
        value /= 36;
        if value == 0 {
            return &output[index..];
        }
    }
}

#[inline]
fn append(destination: &mut [u8], length: &mut usize, source: &[u8]) {
    let end = *length + source.len();
    destination[*length..end].copy_from_slice(source);
    *length = end;
}

fn try_write_cuid2(
    timestamp: u64,
    counter: u64,
    fingerprint: &[u8; FINGERPRINT_LENGTH],
    first_letter: u8,
    salt: &[u8],
    output: &mut [u8],
) -> bool {
    debug_assert_eq!(salt.len(), output.len());
    debug_assert!((MIN_LENGTH as usize..=MAX_LENGTH).contains(&output.len()));

    let mut timestamp_buffer = [0u8; U64_BASE36_LENGTH];
    let timestamp = u64_base36(timestamp, &mut timestamp_buffer);
    let mut counter_buffer = [0u8; U64_BASE36_LENGTH];
    let counter = u64_base36(counter, &mut counter_buffer);

    let mut hash_input = [0u8; HASH_INPUT_LENGTH];
    let mut hash_input_len = 0;
    append(&mut hash_input, &mut hash_input_len, timestamp);
    append(&mut hash_input, &mut hash_input_len, salt);
    append(&mut hash_input, &mut hash_input_len, counter);
    append(&mut hash_input, &mut hash_input_len, fingerprint);

    let mut encoded = [0u8; SHA3_512_BASE36_LENGTH];
    let encoded_len = sha3_base36(&hash_input[..hash_input_len], &mut encoded);
    let encoded_end = output.len() + 1;
    if encoded_len < encoded_end {
        // The canonical algorithm would return a short ID in this vanishingly
        // unlikely case. The caller retries with fresh CSPRNG salt instead.
        return false;
    }

    output[0] = first_letter;
    // `hash()` drops one digit, then ID construction skips one more.
    output[1..].copy_from_slice(&encoded[2..encoded_end]);
    true
}

#[bun_jsc::host_fn(export = "Bun__randomCUID2")]
fn bun_random_cuid2(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let length_value = callframe.argument(0);
    if length_value.is_number() && length_value.as_number().is_nan() {
        return Err(global.throw_range_error(
            f64::NAN,
            bun_jsc::RangeErrorOptions {
                min: MIN_LENGTH as i64,
                max: MAX_LENGTH as i64,
                field_name: b"length",
                ..Default::default()
            },
        ));
    }
    let length = usize::from(global.validate_integer_range::<u8>(
        length_value,
        DEFAULT_LENGTH,
        bun_jsc::IntegerRange {
            min: MIN_LENGTH,
            max: MAX_LENGTH as i128,
            field_name: b"length",
            ..Default::default()
        },
    )?);

    // Canonical CUID2 initializes generator state before drawing the first
    // letter, then samples Date.now(), advances the counter, and draws salt.
    ensure_state(global);
    let mut first_letter = random_letter(global);
    let mut timestamp = global.js_date_now().max(0.0) as u64;
    let (fingerprint, counter) = next_state(global);

    loop {
        let mut random_bytes = [0u8; SALT_ENTROPY_LENGTH];
        let entropy_length = length * size_of::<u32>();
        random_bytes[..entropy_length].copy_from_slice(
            global
                .bun_vm()
                .as_mut()
                .rare_data()
                .entropy_slice(entropy_length),
        );

        let mut salt = [0u8; MAX_LENGTH];
        for (destination, bytes) in salt[..length]
            .iter_mut()
            .zip(random_bytes[..entropy_length].chunks_exact(size_of::<u32>()))
        {
            *destination = BASE36[scale_random_word(word_from_bytes(bytes), 36)];
        }

        let mut id = [0u8; MAX_LENGTH];
        if !try_write_cuid2(
            timestamp,
            counter,
            &fingerprint,
            first_letter,
            &salt[..length],
            &mut id[..length],
        ) {
            first_letter = random_letter(global);
            timestamp = global.js_date_now().max(0.0) as u64;
            continue;
        }

        let (string, bytes) = BunString::create_uninitialized_latin1(length);
        if string.is_dead() {
            return string.into_js(global);
        }
        bytes.copy_from_slice(&id[..length]);
        return string.into_js(global);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha3_512_base36_matches_cuid2() {
        let mut encoded = [0u8; SHA3_512_BASE36_LENGTH];
        let length = sha3_base36(b"", &mut encoded);
        assert_eq!(
            &encoded[..length],
            b"qhwy9hczxnhp8h02w8vk5ozzfbicdzl7bm3tokbnp700ruweb66gvvn2smv2u019fy0avhunqj6eta7kgi9qwexyqb5aufudz52"
        );
    }

    #[test]
    fn fixed_inputs_match_canonical_cuid2_v3_3_0() {
        let mut id = [0u8; 24];
        assert!(try_write_cuid2(
            1_469_918_176_385,
            42,
            b"0123456789abcdefghijklmnopqrstuv",
            b'n',
            b"0123456789abcdefghijklmn",
            &mut id,
        ));
        assert_eq!(&id, b"nqu4uzomwpwo4aavp1zkrl4h");
    }

    #[test]
    fn random_words_scale_like_cuid2() {
        assert_eq!(scale_random_word(0, 36), 0);
        assert_eq!(scale_random_word(u32::MAX, 36), 35);
        assert_eq!(scale_random_word(0, 26), 0);
        assert_eq!(scale_random_word(u32::MAX, 26), 25);
    }
}
