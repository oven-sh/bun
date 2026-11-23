#!/bin/sh
# usage: tools/check-inlined.sh <binary> [file with one regular expression per line, for the findings that are fine]
# What isn't inlined into the entry of a kernel is compiled for the baseline: correct, and slow. This lists
#  - functions that are generic over a target and have code with vectors,
#  - helpers and closures that became functions: they have the features, but their vectors go through memory,
#  - calls out of an entry, but for panics, allocations, mem*, other entries, cold paths of the crate, and on x86 and AArch64 what leads to no code with vectors (ALL_CALLS=1 lists it),
#  - entries that move 16 or more single lanes in or out of vectors, which is what scalarized code does,
#  - entries that move the bits of mask registers into the lanes of a vector,
#  - gathers and scatters that LLVM has made of plain loops for AVX-512. This needs debug = "line-tables-only" or more. Without it, entries with 16 or more of any origin are listed.
BIN=$(ls -d "$(rustc --print sysroot)"/lib/rustlib/*/bin | head -1)
[ -x $BIN/llvm-objdump ] || { echo "this needs the component llvm-tools" >&2; exit 2; }
LINES=; ! $BIN/llvm-objdump -h "$1" | grep -q ' \.debug_line ' || LINES=-l
KNOWN=; ! $BIN/llvm-objdump -f "$1" | grep -q -i -E 'architecture: (x86_64|i386|aarch64)' || [ -n "${ALL_CALLS:-}" ] || KNOWN=1
CODE='[tTwW]'; ! $BIN/llvm-objdump -h "$1" | grep -q ' \.opd ' || CODE='[dD]' # descriptors, on big-endian POWER
ENTRY='^<bun_simd::[^ ]* as bun_simd::gate::Enter>::(run|apart)[0-9]+::<|^<bun_simd::gate::tokens::[a-z0-9_]*<.*> as bun_simd::gate::Enter>::(run|apart)[0-9]+::<|^bun_simd::gate::plain[0-9]+::<bun_simd::gate::Last<|::__[a-z0-9_]+_[0-9]+::<[^{]*$'
{
  $BIN/llvm-nm -C --defined-only "$1" | sed -E 's/tokens::each::[a-z0-9_]+::/tokens::/g' | grep -E " $CODE <?bun_simd::[a-z0-9_:]*Proof" | cut -d' ' -f3- | grep -v -E "$ENTRY|core::fmt::" | sed 's/^/outlined: /'
  $BIN/llvm-nm -C --defined-only "$1" | sed -E 's/tokens::each::[a-z0-9_]+::/tokens::/g' | cut -d' ' -f2- | grep -E "^$CODE <bun_simd::.* as bun_simd::gate::Enter>::run[0-9]+::<bun_simd::gate::(Inlined|Once|Call), " | cut -d' ' -f2- | sed 's/^/apart: /'
  $(dirname "$0")/objdump.sh "$1" $LINES | sed -E 's/tokens::each::[a-z0-9_]+::/tokens::/g' | awk -v entry="$ENTRY" -v lines="$LINES" -v known="$KNOWN" -v ours="$(cd "$(dirname "$0")/.."; pwd -P)/" '
    function flush() { if (lanes >= 16) print "lanes: " lanes " in " short; if (masks >= 3) print "masks: " masks " in " short; if (gathers >= (lines ? 1 : 16)) print "gathers: " gathers " in " short (lines ? ", at" places : "")
      lanes = masks = gathers = 0; places = "" }
    function vectors(f,  i, n, all) { if (!(f in seen) || f in vector) return 1; if (f in visited) return 0; visited[f]
      n = split(callees[f], all, SUBSEP); for (i = 2; i <= n; i++) if (vectors(all[i])) return 1; return 0 }
    function intrinsic(f) { return f ~ /^<?core::core_arch::/ && f !~ /core::fmt::|^core::core_arch::[a-z0-9_:]*(cpuid|xgetbv|xsave)/ }
    /^; / { if (/:[0-9]+$/) place = $2; next }
    /^<.*>:$/ { flush(); name = substr($0, 2, length($0) - 3); sub(/ \(\.llvm\.[0-9]+\)/, "", name); inside = name ~ entry; short = name; sub(/^<bun_simd::(gate::tokens|ops)::/, "", short); sub(/ as bun_simd::gate::Enter>::(run|apart)[0-9]+::<bun_simd::gate::(Natives|Call, )<?/, "::<", short); sub(/^bun_simd::gate::plain[0-9]+::<bun_simd::gate::Last<bun_simd::gate::Natives/, "last::", short); sub(/>, .*/, ">", short); seen[name]; next }
    { sub(/addr32|bnd|notrack/, ""); sub(/ @ imm.*/, ""); $0 = $0 }
    # Not copies, zeros, single floats and counts of bits.
    !inside && /%[xyz]mm/ { op = $1; sub(/^v/, "", op)
      if (op !~ /^(mov(up|ap)[sd]|movdq[ua][0-9]*|mov[dq]|[ac-oq-z][a-z0-9]*s[sd][lq]?|cvtt?s[sd]2si[lq]?)$/ && !(op ~ /xor/ && $2 == $NF ",") && !(op ~ /^(xor|andn?|or)p[sd]$/ && /%rip/)) vector[name] }
    !inside && /[vz][0-9]+\.[0-9]*[bhsdq]/ && $1 !~ /^(movi|cnt|addv|uaddlv)$/ { vector[name] }
    /\*/ { next }
    inside && $1 ~ /^vp?(gather|scatter)[dq]/ && !(lines && place !~ /simd\/(gate|native|closures)\.rs:/ && (place ~ /(core_simd|core_arch|bun_simd[^\/]*)\/src\// || index(place, ours) == 1)) { gathers++; sub(/.*\//, "", place); if (!index(places " ", " " place " ")) places = places " " place }
    !inside && $1 !~ /^(call|j|b|cb|tb)/ { next }
    $1 ~ /^kmov[bwdq]$/ && $2 ~ /^%k/ { from_mask[$3] = NR }
    $1 ~ /^vpinsr[bwd]$/ && NR - from_mask[substr($3, 1, length($3) - 1)] < 6 { masks++ }
    /^[ \t]*pinsr[bw][ \t]+\$0x[123], %/ { next } # It joins the bits of four masks.
    $1 ~ /^v?pextr[bw]$/ && /\$0x[012], .*\)$/ { next }  # the end of a partial store
    $1 ~ /^v?(pextr|pinsr)[bw]$/ || $1 ~ /^[us]mov$/ || ($1 ~ /^(mov|ld1|st1)$/ && /\.[bh]( \})?\[/) { lanes++ }
    # 32-bit Arm, LoongArch, IBM Z, POWER, RISC-V
    $1 ~ /^(vmov\.[us]?|vld1\.|vst1\.)(8|16)$/ && /d[0-9]+\[[0-9]/ || $1 ~ /^x?v(pickve2gr|insgr2vr|stelm)\.[bh]u?$/ || $1 ~ /^v(lgv|lvg|le|ste)[bh]$/ { lanes++ }
    $1 ~ /^(vextu[bh][lr]x|vins[bh]v?[lr]x|vinsert[bh]|vextractu[bh]|lxsi[bh]zx|stxsi[bh]x|mt(vs|fp)r(d|w[az])|vmrg[hl]b)$/ || $1 ~ /^l[bh]z$/ && name !~ /Portable|Baseline/ { lanes++ }
    $1 ~ /^vseti?vli?$/ { small = / e(8|16),/ }
    small && $1 ~ /^v(mv\.x\.s|mv\.s\.x|slide1(down|up)\.vx)$/ { lanes++ }
    $1 ~ /^(call[lq]?|jmp[lq]?|j[a-z]*|b[a-z.+-]*|cbn?z|tbn?z)$/ && !/ # 0x/ && match($0, /[0-9a-f]+(\([a-z0-9]+\))? <.*>$/) {
      to = substr($0, RSTART); sub(/^[^<]*</, "", to); sub(/(\+0x[0-9a-f]+)?>$/, "", to); sub(/ \(\.llvm\.[0-9]+\)/, "", to)
      if (intrinsic(to) && !intrinsic(name)) { print "outlined: " to " in " short; named[to] }
      if (to != name && to !~ entry && to !~ /vqsort::scalar_part|gate::Entering<.*>::cold[0-9]|panic|_fail|Error>?::report|_Unwind_Resume|handle_error|alloc|grow_one|reserve|^(free$|posix_memalign$|mem|bcmp|\*ABS\*|__mem|_init|\.plt|\.iplt|_nl_current|\.L|[0-9a-f]+\.plt_call\._*mem)|load_padded::padded|bun_simd::.*::(near_the_end|remainders)($|::<)|OUTLINED_FUNCTION|^e843419/)
        if (inside) called[to, short]; else callees[name] = callees[name] SUBSEP to
    }
    END { flush()
      for (it in seen) if (intrinsic(it) && !(it in named)) print "outlined: " it
      # What only passes its arguments on to an entry is fine.
      for (it in seen) if (it ~ /^<bun_simd::simd::|bun_simd::(x86|sse2|arm|gate::tokens)::/ && it !~ entry && it !~ /core::fmt::|gate::(first_call|plain[0-9]+)::<|alloc::raw_vec::|OnceLock<.*>::initialize|core::ptr::drop/) { split("", visited); if (!known || vectors(it)) print "outlined: " it }
      for (it in called) { split(it, both, SUBSEP); split("", visited); if (!known || both[1] ~ /bun_simd::/ || vectors(both[1])) print "call: " both[1] " in " both[2] } }' | sort -u
} | awk '{ while (match($0, /__KernelOf[A-Za-z0-9]+/)) { it = substr($0, RSTART + 10, RLENGTH - 10); name = "" # as it was written
    for (i = 1; i <= length(it); i++) { c = substr(it, i, 1); name = name (i > 1 && c ~ /[A-Z]/ ? "_" : "") tolower(c) }
    $0 = substr($0, 1, RSTART - 1) name substr($0, RSTART + RLENGTH) } print }' | grep -v -E -f "${2:-/dev/null}" | cut -c1-300 | grep . && exit 1
exit 0
