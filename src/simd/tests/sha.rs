#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::generic::*;

static K512: [u64; 80] = [
    0x428a2f98d728ae22, 0x7137449123ef65cd, 0xb5c0fbcfec4d3b2f, 0xe9b5dba58189dbbc, 0x3956c25bf348b538,
    0x59f111f1b605d019, 0x923f82a4af194f9b, 0xab1c5ed5da6d8118, 0xd807aa98a3030242, 0x12835b0145706fbe,
    0x243185be4ee4b28c, 0x550c7dc3d5ffb4e2, 0x72be5d74f27b896f, 0x80deb1fe3b1696b1, 0x9bdc06a725c71235,
    0xc19bf174cf692694, 0xe49b69c19ef14ad2, 0xefbe4786384f25e3, 0x0fc19dc68b8cd5b5, 0x240ca1cc77ac9c65,
    0x2de92c6f592b0275, 0x4a7484aa6ea6e483, 0x5cb0a9dcbd41fbd4, 0x76f988da831153b5, 0x983e5152ee66dfab,
    0xa831c66d2db43210, 0xb00327c898fb213f, 0xbf597fc7beef0ee4, 0xc6e00bf33da88fc2, 0xd5a79147930aa725,
    0x06ca6351e003826f, 0x142929670a0e6e70, 0x27b70a8546d22ffc, 0x2e1b21385c26c926, 0x4d2c6dfc5ac42aed,
    0x53380d139d95b3df, 0x650a73548baf63de, 0x766a0abb3c77b2a8, 0x81c2c92e47edaee6, 0x92722c851482353b,
    0xa2bfe8a14cf10364, 0xa81a664bbc423001, 0xc24b8b70d0f89791, 0xc76c51a30654be30, 0xd192e819d6ef5218,
    0xd69906245565a910, 0xf40e35855771202a, 0x106aa07032bbd1b8, 0x19a4c116b8d2d0c8, 0x1e376c085141ab53,
    0x2748774cdf8eeb99, 0x34b0bcb5e19b48a8, 0x391c0cb3c5c95a63, 0x4ed8aa4ae3418acb, 0x5b9cca4f7763e373,
    0x682e6ff3d6b2b8a3, 0x748f82ee5defb2fc, 0x78a5636f43172f60, 0x84c87814a1f0ab72, 0x8cc702081a6439ec,
    0x90befffa23631e28, 0xa4506cebde82bde9, 0xbef9a3f7b2c67915, 0xc67178f2e372532b, 0xca273eceea26619c,
    0xd186b8c721c0c207, 0xeada7dd6cde0eb1e, 0xf57d4f7fee6ed178, 0x06f067aa72176fba, 0x0a637dc5a2c898a6,
    0x113f9804bef90dae, 0x1b710b35131c471b, 0x28db77f523047d84, 0x32caab7b40c72493, 0x3c9ebe0a15c9bebc,
    0x431d67c49c100d4c, 0x4cc5d4becb3e42b6, 0x597f299cfc657e2a, 0x5fcb6fab3ad6faec, 0x6c44198c4a475817,
];
static K256: [u32; 64] = {
    let (mut k, mut i) = ([0; 64], 0);
    while i < 64 {
        k[i] = (K512[i] >> 32) as u32;
        i += 1;
    }
    k
};

#[kernel(targets = bun_simd::target::Targets::ALL)]
pub fn sha1(state: &mut [u32; 5], blocks: &[[u8; 64]]) {
    let mut h = Sha1::<S>::new(*state);
    for block in blocks {
        let (before, mut w) = (h, h.words(block));
        unroll!(for i in 0..20 {
            h = h.rounds4::<i>(w[0]);
            w = [w[1], w[2], w[3], Sha1::schedule(w)];
        });
        h += before;
    }
    *state = h.to_array();
}

#[kernel(targets = bun_simd::target::Targets::ALL)]
pub fn sha256(state: &mut [u32; 8], blocks: &[[u8; 64]]) {
    let mut h = Sha256::<S>::new(*state);
    for block in blocks {
        let (before, mut w) = (h, h.words(block));
        for i in 0..16 {
            h = h.rounds4(w[0] + u32x4::<S>::load(&K256[4 * i..]));
            w = [w[1], w[2], w[3], Sha256::schedule(w)];
        }
        h += before;
    }
    *state = h.to_array();
}

#[kernel(targets = bun_simd::target::Targets::ALL)]
pub fn sha512(state: &mut [u64; 8], blocks: &[[u8; 128]]) {
    let mut h = Sha512::<S>::new(*state);
    for block in blocks {
        let (before, mut w) = (h, h.words(block));
        for i in 0..20 {
            h = h.rounds4(w[0] + u64x4::<S>::load(&K512[4 * i..]));
            w = [w[1], w[2], w[3], Sha512::schedule(w)];
        }
        h += before;
    }
    *state = h.to_array();
}

#[kernel(targets = bun_simd::target::Targets::ALL)]
pub fn sm3(state: &mut [u32; 8], blocks: &[[u8; 64]]) {
    let mut h = Sm3::<S>::new(*state);
    for block in blocks {
        let (before, mut w) = (h, h.words(block));
        unroll!(for i in 0..16 {
            h = h.rounds4::<i>(w[0], w[1]);
            w = [w[1], w[2], w[3], Sm3::schedule(w)];
        });
        h ^= before;
    }
    *state = h.to_array();
}

#[kernel(targets = bun_simd::target::Targets::ALL)]
pub fn sm4_keys(key: &[u8; 16]) -> [u32; 32] {
    let mut keys = [0; 32];
    let mut k = u8x16::<S>::load(key).bitcast::<u32>().swap_bytes();
    k ^= u32x4::<S>::from([0xa3b1_bac6, 0x56aa_3350, 0x677d_9197, 0xb270_22dc]);
    for i in 0..8 {
        k = k.sm4_next_keys((u8x16::<S>::iota(16 * i as u8) * 7).bitcast::<u32>().swap_bytes());
        k.store(&mut keys[4 * i..]);
    }
    keys
}

#[kernel(targets = bun_simd::target::Targets::ALL)]
pub fn sm4_encrypt(keys: &[u32; 32], blocks: &mut [[u8; 64]]) {
    for block in blocks {
        let mut v = u8x64::<S>::load(block).bitcast::<u32>().swap_bytes();
        for keys in keys.as_chunks::<4>().0 {
            v = v.sm4_rounds4(u32x16::<S>::load_block(keys));
        }
        v.swizzle_groups([3, 2, 1, 0]).swap_bytes().bitcast::<u8>().store(block);
    }
}

/// One block with "abc", and two with 56 or 112 letters, from FIPS 180.
#[test]
fn vectors() {
    fn padded<const N: usize>(text: &[u8]) -> Vec<[u8; N]> {
        let mut all = [text, &[0x80]].concat();
        all.resize((all.len() + N / 8).next_multiple_of(N) - 8, 0);
        all.extend((8 * text.len() as u64).to_be_bytes());
        all.as_chunks().0.to_vec()
    }
    let long = b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
    let longer = b"abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu";
    const H: [u64; 8] = [
        0x6a09e667f3bcc908, 0xbb67ae8584caa73b, 0x3c6ef372fe94f82b, 0xa54ff53a5f1d36f1, 0x510e527fade682d1,
        0x9b05688c2b3e6c1f, 0x1f83d9abfb41bd6b, 0x5be0cd19137e2179,
    ];
    for &target in Target::ALL.iter().filter(|it| it.is_supported()) {
        let one = |text: &[u8]| {
            let mut h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
            sha1::to(target, &mut h, &padded(text));
            h
        };
        assert_eq!(one(b"abc"), [0xa9993e36, 0x4706816a, 0xba3e2571, 0x7850c26c, 0x9cd0d89d], "{target:?}");
        assert_eq!(one(long), [0x84983e44, 0x1c3bd26e, 0xbaae4aa1, 0xf95129e5, 0xe54670f1], "{target:?}");
        let two = |text: &[u8]| {
            let mut h = H.map(|it| (it >> 32) as u32);
            sha256::to(target, &mut h, &padded(text));
            h
        };
        assert_eq!(
            two(b"abc"),
            [0xba7816bf, 0x8f01cfea, 0x414140de, 0x5dae2223, 0xb00361a3, 0x96177a9c, 0xb410ff61, 0xf20015ad],
            "{target:?}"
        );
        assert_eq!(
            two(long),
            [0x248d6a61, 0xd20638b8, 0xe5c02693, 0x0c3e6039, 0xa33ce459, 0x64ff2167, 0xf6ecedd4, 0x19db06c1],
            "{target:?}"
        );
        let three = |text: &[u8]| {
            let mut h = H;
            sha512::to(target, &mut h, &padded(text));
            h
        };
        assert_eq!(
            three(b"abc"),
            [
                0xddaf35a193617aba, 0xcc417349ae204131, 0x12e6fa4e89a97ea2, 0x0a9eeee64b55d39a, 0x2192992a274fc1a8,
                0x36ba3c23a3feebbd, 0x454d4423643ce80e, 0x2a9ac94fa54ca49f
            ],
            "{target:?}"
        );
        assert_eq!(
            three(longer),
            [
                0x8e959b75dae313da, 0x8cf4f72814fc143f, 0x8f7779c6eb9f7fa1, 0x7299aeadb6889018, 0x501d289e4900f7e4,
                0x331b99dec4b5433a, 0xc7d329eeb6dd2654, 0x5e96e55b874be909
            ],
            "{target:?}"
        );
        // GB/T 32905, A.1 and A.2
        let four = |text: &[u8]| {
            let mut h =
                [0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600, 0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e];
            sm3::to(target, &mut h, &padded(text));
            h
        };
        assert_eq!(
            four(b"abc"),
            [0x66c7f0f4, 0x62eeedd9, 0xd1f2d46b, 0xdc10e4e2, 0x4167c487, 0x5cf2f7a2, 0x297da02b, 0x8f4ba8e0],
            "{target:?}"
        );
        assert_eq!(
            four(&b"abcd".repeat(16)),
            [0xdebe9ff9, 0x2275b8a1, 0x38604889, 0xc18e5a4d, 0x6fdb70e5, 0x387e5765, 0x293dcba3, 0x9c0c5732],
            "{target:?}"
        );
        // GB/T 32907, A.1
        let key = 0x0123456789abcdeffedcba9876543210u128.to_be_bytes();
        let mut blocks = [*[key; 4].as_flattened().as_array().unwrap()];
        sm4_encrypt::to(target, &sm4_keys::to(target, &key).unwrap(), &mut blocks);
        assert_eq!(blocks[0], [0x681edf34d206965e86b3e94f536e4246u128.to_be_bytes(); 4].as_flattened(), "{target:?}");
    }
}

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn aes(keys: &[[u8; 16]], block: [u8; 16]) -> bool {
    let (v, mut inverse) =
        ([u8xN::<S>::load_block(&block), u8xN::<S>::iota(block[0]), u8xN::<S>::splat(block[1])], keys.to_vec());
    let by_rounds = v.map(|v| {
        let v = keys[1..keys.len() - 1]
            .iter()
            .fold(v ^ u8xN::<S>::load_block(&keys[0]), |v, key| v.aes_round(u8xN::<S>::load_block(key)));
        v.aes_last_round(u8xN::<S>::load_block(&keys[keys.len() - 1]))
    });
    inverse.reverse();
    inverse[1..keys.len() - 1].iter_mut().for_each(|key| u8x16::<S>::load(key).aes_inv_mix_columns().store(key));
    let encrypted = Simd::aes_encrypt(v, keys);
    let decrypted = Simd::aes_decrypt(encrypted, &inverse);
    (0..3).all(|i| encrypted[i].simd_eq(by_rounds[i]).all() && decrypted[i].simd_eq(v[i]).all())
}

#[test]
fn all_rounds_of_aes() {
    let keys: Vec<[u8; 16]> = (0..15).map(|i| core::array::from_fn(|j| (i * 37 + j * j * 11) as u8)).collect();
    for &target in Target::ALL {
        for n in [2, 3, 11, 13, 15] {
            assert_ne!(aes::to(target, &keys[..n], keys[n - 1]), Some(false), "{target:?} {n}");
        }
    }
}

/// By the definition, with the table from the affine maps and the inverse modulo 0x1f5.
fn sm4_model(mut x: [u32; 4], with: [u32; 4], keys: bool) -> [u32; 4] {
    let affine = |x: u8| x ^ x.rotate_left(1) ^ x.rotate_left(3) ^ x.rotate_left(6) ^ x.rotate_left(7) ^ 0xd3;
    let mul = |a: u8, b: u8| (0..8).rev().fold(0u8, |p, i| (p << 1) ^ ((p >> 7) * 0xf5) ^ (a * (b >> i & 1)));
    let substitute = |x: u8| affine((0..=255).find(|&it| mul(it, affine(x)) == 1).unwrap_or(0));
    for i in 0..4 {
        let t = u32::from_ne_bytes(
            (x[(i + 1) % 4] ^ x[(i + 2) % 4] ^ x[(i + 3) % 4] ^ with[i]).to_ne_bytes().map(substitute),
        );
        x[i] ^=
            (if keys { &[13, 23][..] } else { &[2, 10, 18, 24] }).iter().fold(t, |all, &by| all ^ t.rotate_left(by));
    }
    x
}

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn sm4_widths(x: &[u32; 16], with: &[u32; 16]) -> [[u32; 16]; 6] {
    let mut out = [[0; 16]; 6];
    macro_rules! by { ($($i:literal $v:ident)*) => {$(for at in (0..16).step_by($v::<S>::LANES) {
        let (x, with) = ($v::<S>::load(&x[at..]), $v::<S>::load(&with[at..]));
        x.sm4_rounds4(with).store(&mut out[$i][at..]);
        x.sm4_next_keys(with).store(&mut out[$i + 1][at..]);
    })*}; }
    by!(0 u32x4 2 u32x8 4 u32x16);
    out
}

#[test]
fn sm4_of_blocks_that_differ() {
    let mut seed = 1u64;
    let mut next = || -> [u32; 16] {
        core::array::from_fn(|_| {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (seed >> 32) as u32
        })
    };
    for _ in 0..40 {
        let (x, with) = (next(), next());
        let want =
            [false, true].map(|keys| [0, 1, 2, 3].map(|i| sm4_model(x.as_chunks().0[i], with.as_chunks().0[i], keys)));
        for &target in Target::ALL {
            for (i, got) in sm4_widths::to(target, &x, &with).iter().flatten().enumerate() {
                assert_eq!(got, want[i % 2].as_flattened(), "{target:?} {i}");
            }
        }
    }
}
