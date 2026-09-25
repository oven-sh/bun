# Codex pass 2 SAFETY-comment gap index

This document turns the first pass's rough "SAFETY-comment coverage" claim into a reproducible heuristic baseline.

## Heuristic

For every source-level unsafe site in `unsafe-inventory.jsonl`, Codex checked a small context window around the site and counted it as "covered" if the context contained one of:

- `SAFETY`
- `Safety`
- `# Safety`
- `INVARIANT`
- `Invariant`

This is intentionally imperfect:

- It undercounts sites documented by a module-level invariant far away from the unsafe line.
- It overcounts comments that say "not safe" or merely mention safety without proving anything.
- It is still useful because it is cheap, repeatable, and points reviewers at the densest hardening work.

## Result

| Metric | Count |
| --- | ---: |
| Unsafe sites checked | 11,044 |
| Nearby safety marker present | 9,450 |
| Nearby safety marker missing | 1,594 |

Approximate marker coverage by this heuristic: **85.6%**.

## Top categories by missing nearby marker

| Category | Missing / total |
| --- | ---: |
| `other` | 494 / 3,533 |
| `ptr_cast` | 249 / 2,231 |
| `fd_syscall` | 198 / 1,292 |
| `libc_ffi` | 121 / 345 |
| `ptr_intrinsic` | 118 / 956 |
| `zig_port_mut_ref` | 108 / 923 |
| `other_unsafe_impl` | 89 / 188 |
| `zig_port_self_call` | 79 / 239 |
| `raw_ptr_lifecycle` | 73 / 537 |
| `zig_port_shared_ref` | 56 / 448 |
| `libuv_ffi` | 55 / 254 |
| `c_alloc` | 50 / 288 |
| `raw_cast` | 48 / 187 |
| `allocator` | 47 / 169 |
| `slice_from_raw` | 44 / 298 |

## Top crates by missing nearby marker

| Crate | Missing / total |
| --- | ---: |
| `bun_runtime` | 654 / 4,893 |
| `bun_bundler` | 132 / 498 |
| `bun_core` | 125 / 461 |
| `bun_sys` | 111 / 332 |
| `bun_install` | 89 / 525 |
| `bun_jsc` | 62 / 745 |
| `bun_alloc` | 61 / 273 |
| `bun_libuv_sys` | 41 / 133 |
| `bun_collections` | 24 / 157 |
| `bun_cares_sys` | 23 / 75 |

## How to use this

Do not file 1,594 individual comment beads. Use this as a triage index:

1. Start with P0/P1 findings and watchlist sites.
2. Then harden the top missing categories that are (A), especially `zig_port_mut_ref`, `raw_ptr_lifecycle`, `libc_ffi`, and `libuv_ffi`.
3. Ignore or deprioritize (C) sites that are scheduled to disappear.
4. Re-run the heuristic after each documentation sweep and track the count delta.

The final polished audit should include both numbers:

- source-level unsafe site count;
- source-level unsafe sites without a nearby proof marker.

