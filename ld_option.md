# Keeping Specific Local Symbols on macOS (`ld64`)

**Purpose**: Guide to prevent selected non‑global (lowercase `t` in `nm`) symbols from being stripped when linking with `-dead_strip`, using `-non_global_symbols_no_strip_list`.

---

## 1. Overview

- `-dead_strip` removes code/data sections that appear unreferenced.
- Local (non‑global) symbols are normally stripped as well.
- `-non_global_symbols_no_strip_list <path>` tells `ld64` to keep the symbol _names_ you list, so they remain visible in `nm`/debuggers.

> ❗ **Note:** This option only preserves the _symbol names_. If the containing section is removed by `-dead_strip`, the symbol will still disappear unless you also mark it `__attribute__((used))` or emit a `.no_dead_strip` directive.

## 2. Create the keep‑list file

Plain‑text file, one (mangled) symbol per line **exactly** as shown by `nm -m` (keep the leading underscore).

```text
# keep.txt
_my_debug_symbol
_static_helper
```

**Tips**

- Collect candidates with `nm -m object.o | grep ' t '`.
- For C++ symbols copy the mangled names verbatim.

## 3. Add the switch to the **link** step

```bash
clang -Oz -c foo.c
clang -Oz -c bar.c

clang -Wl,-dead_strip \
      -Wl,-non_global_symbols_no_strip_list,keep.txt \
      -o myprog foo.o bar.o
```

- Use the `-Wl,` prefix so Clang forwards the flag to `ld64`.
- The list path may be absolute or relative to the current directory.

## 4. Verifying the result

```bash
nm myprog | grep ' t '
```

Symbols named in `keep.txt` should still appear (`t` or `t (private external)`), while other locals are gone.

## 5. Preventing code removal (optional)

If the linker would otherwise discard the _section_ containing the symbol, pin it:

```c
static void hidden_logger(void) __attribute__((used));
static void hidden_logger(void) { /* … */ }
```

or in inline assembly:

```asm
.no_dead_strip _hidden_logger
```

## 6. Debug builds vs. release builds

| Build type  | Recommendation                                                                      |
| ----------- | ----------------------------------------------------------------------------------- |
| **Debug**   | Usually skip `-dead_strip` entirely for easier debugging.                           |
| **Release** | Keep `-dead_strip` for size, combine with a keep‑list to preserve essential locals. |

## 7. Common pitfalls

| Symptom                                            | Likely cause              | Fix                                              |
| -------------------------------------------------- | ------------------------- | ------------------------------------------------ |
| `ld: can't open -non_global_symbols_no_strip_list` | Missing comma after `-Wl` | `-Wl,-non_global_symbols_no_strip_list,keep.txt` |
| Symbol still missing after link                    | Section was dead‑stripped | Add `__attribute__((used))` or `.no_dead_strip`  |
| C++ symbol written demangled in file               | Used the demangled name   | Copy the mangled form from `nm -m`               |

## 8. References

- `man ld` (macOS) – search for _non_global_symbols_no_strip_list_.
- Apple Developer Technical Q\&A **QA1118** “Understanding in‑linker dead‑strip options”.

---

_Last updated: 2025‑07‑08_
