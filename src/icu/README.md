# bun_icu

The functions of ICU's C API that JavaScriptCore, WTF and Bun's C++ call, for the arguments that they pass, and a part of
`ubidi.h`. The callers are compiled against ICU4C's headers, and the data package is ICU4C's. Both come with WebKit's build
(`scripts/build/deps/webkit.ts`). The crate is empty where the system's ICU is used: on macOS, and on Linux with a local
WebKit without `BUN_ICU_ROOT`.

|                    |                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `capi/`            | The exported functions, one file per header. `capi/ffi/` turns pointers into references.                         |
| `common/`, `i18n/` | The code of ICU4C's libraries of these names, mostly under the name of the file it is derived from. No `unsafe`. |
| `sys/`             | The linked data package, files, and the locale and time zone of the host.                                        |
| `data/`            | The tables that ICU4C compiles in, as in its `source/data/in`.                                                   |

## When a caller changes

- A function that is missing fails the link (`undefined symbol: ucal_roll_79`).
- An argument that is not supported gives `U_UNSUPPORTED_ERROR`, or fails a debug assertion. The
  comment at the function in `capi/` says which values it takes. Compare the calls of ICU when you upgrade WebKit.
- Nothing checks the rules for pointers under "Exported functions".
- JavaScriptCore passes its default locale on with all its keywords, so any keyword can arrive.
- Of the `U_USING_*` warnings only `U_USING_DEFAULT_WARNING` is set, by `ucurr_getName`, whose caller reads it.

## When ICU's version changes

A `static_assert` in `bun_icu_decompress.cpp` fails.

1. Record `test/js/web/intl/intl-golden` with the new ICU4C, and set `version` in its `observe.ts`. To get such a Bun, link
   ICU's `code` libraries (`scripts/build/deps/webkit.ts`) and set `--cfg=bun_system_icu` (`scripts/build/rust.ts`).
2. Port the changes of the files named in the `ICU4C:` comments, tables included, and copy `data/`.
3. Set the version in the `static_assert`, `capi/uversion.rs`, `lib.rs`, the licence pages, and the names of the symbols
   and items (`git grep -E '_79|icudt79' src/icu test/js/web/intl`).
4. Check what the comments say about "the linked data" (`git grep -i 'linked' src/icu`).

## Data from files

`ICU_DATA` names directories and packages that replace items or add some, and `ICU_TIMEZONE_FILES_DIR` does so for the four
time zone files. So the readers take all forms that ICU's tools write, and do not trust what they read. A file with a
header that does not fit is passed over.

If `searches_files` is false, some code skips what the linked data do not need. `ICU_DATA=nowhere` turns that off.

## Exported functions

```rust
#[capi]
fn u_strToLower((dest, _): Dest<UChar>, (src, _): Text<UChar>, locale: NulStr<u8>, status: ErrorCode) -> i32 { .. }
```

The body is safe code. The signature is trusted: each type states what the callers guarantee. `(s, length): T` stands for
two C parameters, and `#[len(n)] s: T` takes the second from a later parameter.

| C                                   | Rust                           |
| ----------------------------------- | ------------------------------ |
| `const char *s`                     | `NulStr<u8>`                   |
| `const UChar *s, int32_t length`    | `Text<UChar>`                  |
| `const T *array, int32_t length`    | `Array<T>`                     |
| `T *dest, int32_t capacity`         | `Dest<T>`                      |
| `T *result`                         | `Out<T>`                       |
| `T *` that all callers leave null   | `Null`                         |
| `const UObject *`, `UObject *`      | `Option<&H>`, `Option<&mut H>` |
| `UObject *` to open, close or adopt | `Option<Box<H>>`               |
| `UErrorCode *`                      | `ErrorCode`                    |

- An `Out`, the status and a handle that the call modifies share no memory with what the other arguments lead to. A
  `Dest` shares none with handles and what they own.
- Handles, `Out` and the status are null or valid, even if the status is a failure.
- A source may overlap a `Dest`. Read it before the first write, or pass it through `Dest::apart`: the types do not check that.
- The pointer to a returned string comes from a slice that includes the NUL, or from `Vec::as_ptr`. Moving a `Box`
  invalidates pointers to its contents. Moving a `Vec` does not.

## Allocation

A refused allocation is `U_MEMORY_ALLOCATION_ERROR`, so everything goes through `common/memory.rs`. Errors are often
dropped on purpose (a bundle that cannot be opened counts as missing), so a failure also sets a thread-local flag. While it
is set all allocations fail, and nothing that was computed after the failure can be cached. The exported function takes
the flag when it returns.

- Propagate errors with `?`. Use `defer_oom` where none can be returned.
- Append with `Appendable`. Use `try_push(..)?` if later code depends on the index or the length, or if the list outlives
  the call.
- Call `fail_on_oom` or `oom_checked` before storing a value or an error without allocating.
- `best_effort` is for what may be left out, such as inserting a finished value into a cache.
- Open files through `sys/file.rs`. The path buffers and errors of `bun_sys` end the process.

## Indexing

`SliceExt` (`at`, `slice`, `set`) is for an index that sound data never take out of bounds: a debug assertion, then a
default. Use `get` where the end is an ordinary case.
