// ── csprng ────────────────────────────────────────────────────────────────
// Zig calls `BoringSSL.c.RAND_bytes` (bun.zig:621). bun_core sits below
// boringssl_sys in the crate graph, so we go to the OS CSPRNG directly:
// getrandom(2) on Linux, SecRandomCopyBytes/getentropy on Darwin,
// RtlGenRandom on Windows. All are the same entropy source BoringSSL seeds
// from. PERF(port): if a hot path needs the BoringSSL DRBG, install a
// vtable hook from bun_runtime at startup.
pub fn csprng(bytes: &mut [u8]) {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        let mut filled = 0usize;
        while filled < bytes.len() {
            // SAFETY: writes at most len-filled bytes into the slice.
            let rc = unsafe {
                libc::getrandom(
                    bytes.as_mut_ptr().add(filled).cast(),
                    bytes.len() - filled,
                    0,
                )
            };
            if rc < 0 {
                let err = crate::ffi::errno();
                if err == libc::EINTR {
                    continue;
                }
                panic!("getrandom failed: errno {err}");
            }
            filled += rc as usize;
        }
    }
    #[cfg(any(target_os = "macos", target_os = "ios", target_os = "freebsd"))]
    {
        // getentropy caps at 256 bytes per call.
        for chunk in bytes.chunks_mut(256) {
            // SAFETY: chunk is a valid writable slice ≤ 256 bytes.
            let rc = unsafe { libc::getentropy(chunk.as_mut_ptr().cast(), chunk.len()) };
            if rc != 0 {
                panic!("getentropy failed");
            }
        }
    }
    #[cfg(windows)]
    {
        unsafe extern "system" {
            // advapi32!SystemFunction036 a.k.a. RtlGenRandom — what BoringSSL uses on Windows.
            #[link_name = "SystemFunction036"]
            fn RtlGenRandom(buf: *mut u8, len: u32) -> u8;
        }
        for chunk in bytes.chunks_mut(u32::MAX as usize) {
            // SAFETY: chunk fits in u32; RtlGenRandom writes exactly that many bytes.
            let ok = unsafe { RtlGenRandom(chunk.as_mut_ptr(), chunk.len() as u32) };
            if ok == 0 {
                panic!("RtlGenRandom failed");
            }
        }
    }
}

// ── rand ──────────────────────────────────────────────────────────────────
// `std.Random.DefaultPrng` is xoshiro256++ in Zig stdlib. Port the exact
// algorithm so `bun.fastRandom()` output is reproducible across the rewrite.
/// xoshiro256++ — `std.Random.DefaultPrng`.
#[derive(Clone, Copy)]
pub struct DefaultPrng {
    s: [u64; 4],
}
impl DefaultPrng {
    /// Seed via splitmix64 (matches Zig stdlib `Xoshiro256.init`).
    pub fn init(seed: u64) -> Self {
        let mut sm = seed;
        let mut s = [0u64; 4];
        for slot in &mut s {
            sm = sm.wrapping_add(0x9e3779b97f4a7c15);
            let mut z = sm;
            z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
            *slot = z ^ (z >> 31);
        }
        Self { s }
    }
    #[inline]
    pub fn next_u64(&mut self) -> u64 {
        let r = self.s[0]
            .wrapping_add(self.s[3])
            .rotate_left(23)
            .wrapping_add(self.s[0]);
        let t = self.s[1] << 17;
        self.s[2] ^= self.s[0];
        self.s[3] ^= self.s[1];
        self.s[1] ^= self.s[2];
        self.s[0] ^= self.s[3];
        self.s[2] ^= t;
        self.s[3] = self.s[3].rotate_left(45);
        r
    }
}

/// Port of `bun.fastRandom()`. Thread-local xoshiro256++ seeded once per
/// process from the OS CSPRNG (or `BUN_DEBUG_HASH_RANDOM_SEED` in debug).
pub fn fast_random() -> u64 {
    use core::cell::Cell;
    use core::sync::atomic::{AtomicU64, Ordering as O};
    static SEED: AtomicU64 = AtomicU64::new(0);
    fn random_seed() -> u64 {
        let mut v = SEED.load(O::Relaxed);
        while v == 0 {
            // Spec (bun.zig:575) gates on `Environment.isDebug or Environment.is_canary`;
            // bun_core has no `canary` cargo feature yet, so debug-only for now (no
            // regression vs. either pre-dedup copy — tracked separately).
            #[cfg(debug_assertions)]
            if let Some(n) = crate::env_var::BUN_DEBUG_HASH_RANDOM_SEED.get() {
                SEED.store(n, O::Relaxed);
                return n;
            }
            let mut buf = [0u8; 8];
            csprng(&mut buf);
            v = u64::from_ne_bytes(buf);
            SEED.store(v, O::Relaxed);
            v = SEED.load(O::Relaxed);
        }
        v
    }
    thread_local! {
        static PRNG: Cell<Option<DefaultPrng>> = const { Cell::new(None) };
    }
    PRNG.with(|p| {
        let mut prng = p.take().unwrap_or_else(|| DefaultPrng::init(random_seed()));
        let v = prng.next_u64();
        p.set(Some(prng));
        v
    })
}
