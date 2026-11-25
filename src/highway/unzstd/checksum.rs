//! XXH64 takes two multiplications for each word, and the first does not have to wait for anything.

/// Does `lane = (lane + word * factors[0]).rotate_left(31) * factors[1]` for some of `stripes`. Returns the others.
#[inline]
pub fn consume_stripes<'a>(
    lanes: &mut [u64; 4],
    factors: [u64; 2],
    stripes: &'a [[u8; 32]],
) -> &'a [[u8; 32]] {
    #[cfg(all(target_arch = "x86_64", not(miri)))]
    if stripes.len() >= 16 && is_x86_feature_detected!("avx2") {
        let fours = stripes.as_chunks().0;
        // SAFETY: see above.
        unsafe { with_avx2(lanes, factors, fours) };
        return &stripes[4 * (fours.len() - 1)..];
    }
    let _ = (lanes, factors);
    stripes
}

/// For all but the last of `fours`. SAFETY: they are two or more.
#[cfg(all(target_arch = "x86_64", not(miri)))]
#[target_feature(enable = "avx2")]
unsafe fn with_avx2([a, b, c, d]: &mut [u64; 4], factors: [u64; 2], fours: &[[[u8; 32]; 4]]) {
    macro_rules! multiply {
        () => {
            lines!(
                "vmovshdup ymm0, [rsi + 32 * \\stripe]",
                "vpmuludq ymm0, ymm0, ymm4",
                "vpmuludq ymm1, ymm5, [rsi + 32 * \\stripe]",
                "vpmuludq ymm2, ymm4, [rsi + 32 * \\stripe]",
                "vpaddq ymm0, ymm0, ymm1",
                "vpsllq ymm0, ymm0, 32",
                "vpaddq ymm0, ymm0, ymm2",
                "vmovdqa [rdi + 32 * \\stripe], ymm0",
            )
        };
    }

    let mut products = core::mem::MaybeUninit::<[[u8; 32]; 4 + 1]>::uninit();
    // SAFETY: it reads `fours`, and the products that it has written.
    unsafe {
        core::arch::asm!(
            "add rdi, 31",
            "and rdi, -32",
            "vmovq xmm4, rdx",
            "vpbroadcastq ymm4, xmm4",
            "vpsrlq ymm5, ymm4, 32",
            ".irp stripe, 0, 1, 2, 3",
            multiply!(),
            ".endr",
            "add rsi, 128",
            ".p2align 5",
            "2:",
            ".irp stripe, 0, 1, 2, 3",
            ".irp lane, 8, 9, 10, 11",
            "add r\\lane, [rdi + 32 * \\stripe + 8 * (\\lane - 8)]",
            "rol r\\lane, 31",
            "imul r\\lane, rcx",
            ".endr",
            multiply!(),
            ".endr",
            "add rsi, 128",
            ".p2align 5, , 9",
            "cmp rsi, rax",
            "jb 2b",
            "vzeroupper",
            in("rax") fours.as_ptr_range().end,
            in("rcx") factors[1],
            in("rdx") factors[0],
            inout("rsi") fours.as_ptr() => _,
            inout("rdi") &raw mut products => _,
            inout("r8") *a, inout("r9") *b, inout("r10") *c, inout("r11") *d,
            clobber_abi("sysv64"),
            options(nostack),
        );
    }
}
