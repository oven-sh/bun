### Reproduction

Three archives, extracted into the same directory with plain `Bun.Archive`. Each one passes the checks of main on its own.

```python
# mk.py
import tarfile, io
def tar(n, m, data=None):
    with tarfile.open(n, "w") as t:
        if data is not None: m.size = len(data)
        t.addfile(m, io.BytesIO(data) if data is not None else None)
def sym(n, to):
    i = tarfile.TarInfo(n); i.type = tarfile.SYMTYPE; i.linkname = to; return i
tar("a1.tar", sym("d1", "."))
tar("a2.tar", sym("d1/d2/up", "../.."))
tar("a3.tar", tarfile.TarInfo("d1/d2/up/victim/file.txt"), b"OVERWRITTEN\n")
```

```js
// x.mjs
for (const t of ["a1.tar", "a2.tar", "a3.tar"])
  console.log(t, await new Bun.Archive(await Bun.file(t).bytes()).extract("./out").catch(e => `${e.code} ${e.path}`));
console.log((await Bun.file("victim/file.txt").text()).trim());
```

```
mkdir victim && echo ORIGINAL > victim/file.txt && python3 mk.py && bun x.mjs
```

On main at `a407eae88a` (debug build), `./victim` is outside `./out` and is overwritten:

```
a1.tar 1
a2.tar 1
a3.tar 1
OVERWRITTEN
```

On this branch at `e8870e810d` (debug build, `src/` as at the head):

```
a1.tar 1
a2.tar ELOOP d1/d2/up
a3.tar ELOOP d1/d2/up/victim/file.txt
ORIGINAL
```

The short form needs no chain. `out/cfg -> ../victim/f.txt` is already on disk, and the archive has a regular member named `cfg`. On 1.4.3 the extraction writes the member into `victim/f.txt`. On this branch `victim/f.txt` keeps its content, and `out/cfg` becomes a regular file. GNU tar 1.35 and node-tar 7.5.15 also replace the link.

### Verified at `e8870e810d` (debug build, linux-x64)

The head `b6688effec` adds a guard in one test. `src/` is the same, and `archive.test.ts` ran again on it with the same result.

- `bun bd test test/js/bun/archive.test.ts`: 141 pass, 5 skip as root. 143 pass, 3 skip as uid 65534. A debug build of main at `a407eae88a` fails 15 tests of the `path safety` block.
- `bun bd test test/js/node/fs/fs-stat-seccomp-linux.test.ts`: 21 pass, 2 skip. Main fails the 7 `openat2` tests.
- `test/cli/install/bun-create.test.ts`: 86 pass. `bun-pm-cache-pack.test.ts`: 199 pass (with a longer timeout). `bun-install-streaming-extract.test.ts`: 62 pass. `symlink-path-traversal.test.ts`: 52 pass. `bun-install-tarball-integrity.test.ts`: 165 pass, 42 skip.
- `bun run rust:check-all`: 12 of 12 targets.

Windows is not covered by this PR. macOS passed in CI on the head before the rebase.
