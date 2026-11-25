# bun_icu

The functions of ICU's C API that JavaScriptCore, WTF and Bun's C++ call, for the arguments that they pass, and a part of
`ubidi.h`. The callers are compiled against ICU4C's headers, which come with WebKit's build (`scripts/build/deps/webkit.ts`).
The crate is empty where the system's ICU is used: on macOS, and on Linux with a local WebKit without `BUN_ICU_ROOT`.

|                    |                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `capi/`            | The exported functions, one file per header. `capi/ffi/` turns pointers into references.                         |
| `common/`, `i18n/` | The code of ICU4C's libraries of these names, mostly under the name of the file it is derived from. No `unsafe`. |
| `sys/`             | The linked data package, files, and the locale and time zone of the host.                                        |
| `data/`            | The tables that ICU4C compiles in, as in its `source/data/in`, and `package.bin`, the linked data package.       |
| `format/`          | The format of `package.bin`. A crate of its own, which `src/icu_pack` and `src/trim` use too.                    |

## When a caller changes

- A function that is missing fails the link (`undefined symbol: ucal_roll_79`).
- An argument that is not supported gives `U_UNSUPPORTED_ERROR`, or fails a debug assertion. The
  comment at the function in `capi/` says which values it takes. Compare the calls of ICU when you upgrade WebKit.
- The linked data have only what the callers can reach. `src/icu_pack/reach.rs` lists it. What it leaves out counts as
  missing, so that the root's text shows, or an error.
- Nothing checks the rules for pointers under "Exported functions".
- JavaScriptCore passes its default locale on with all its keywords, so any keyword can arrive.
- Of the `U_USING_*` warnings only `U_USING_DEFAULT_WARNING` is set, by `ucurr_getName`, whose caller reads it.

## When ICU's version changes

A `static_assert` in `bun_icu_default_locale.cpp` fails.

1. Record `test/js/web/intl/intl-golden` with the new ICU4C, and set `version` in its `observe.ts`. To get such a Bun,
   install that ICU4C on Linux and build with a local WebKit without `BUN_ICU_ROOT`.
2. Port the changes of the files named in the `ICU4C:` comments, tables included, and copy `data/`.
3. Set the version in the `static_assert`, `capi/uversion.rs`, `lib.rs`, the licence pages, and the names of the symbols
   and items (`git grep -E '_79|icudt79' src/icu test/js/web/intl`).
4. Check what the comments say about "the linked data" (`git grep -i 'linked' src/icu`).
5. Compare `src/icu_pack/reach.rs` with the keys that the new code reads, and write the linked data again.

## The linked data

```sh
cargo run --release -p bun_icu_pack < icu/source/data/in/icudt79l.dat > new.bin && mv new.bin src/icu/data/package.bin
```

Run it after each change of `format/` or `src/icu_pack`. The input is in the sources of ICU4C's release. The output depends
on nothing else, and the packer reads back what it has written. No call may take longer than with ICU4C's package, the first one included (`bench/snippets/intl-first-use.mjs`),
so nothing is expanded that the call does not read.

| What                                | Form                                                                    | Expanded                |
| ----------------------------------- | ----------------------------------------------------------------------- | ----------------------- |
| Text of locales                     | Pieces from a table of the language, and copies from a similar language | In chunks of about 1 KB |
| Collation                           | Runs of weights, and for each tailoring what it changes                 | 32 code points          |
| Han in Chinese and Japanese order   | A weight for each character, and above U+FFFF a bitmap to find it       | No                      |
| Dictionaries for breaking text      | A trie with bitmaps in the place of pointers                            | No                      |
| Break rules, `rbnf/`, `CurrencyMap` | Literal bytes and copies                                                | A file                  |
| Other bundles                       | As in `.res` files, with shared keys and strings                        | No                      |
| Normalization, emoji                | As in ICU4C                                                             | No                      |

What has been expanded stays. `--trim` removes items (`src/trim/icu_data.rs`, `scripts/build/trim/icu-data.ts`), so files
share an item only if they are removed together.

## Data from files

`ICU_DATA` names directories and packages that replace items or add some, and `ICU_TIMEZONE_FILES_DIR` does so for the four
time zone files. So the readers take all forms that ICU's tools write, and do not trust what they read. A file with a
header that does not fit is passed over, and so is a bundle that comes without its `pool.res`.

Files can ask for more than the linked data do. For them the root bundles of the trees with text are complete, and so are
the tables in `COLD` in `reach.rs`. What else they refer to has to be among the files. ICU4C's `icudt79l.dat` in one of the
directories adds the items that are not linked, but not what has been left out of a linked bundle.

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
