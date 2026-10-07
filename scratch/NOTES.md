
## Self-review result (run 5752ed1a1826, Oct 7): PARK. No PR opened.
Disposition "close" (park); wanted verdict "unclear-ask-a-human" 0.45. Defect and fix confirmed by the review
(its own sweep: 0 of 704,805 split runs differ on 168 cases; main's patch differs on 178,150).
Reason to park: no demand (0 reports; 0 scanned registry/GitHub tarballs with these header forms), REVIEW.md
"no speculative edge-case handling nobody filed an issue for", and the branch is not safe alone (below).
Bring it back on: a maintainer yes to stream == buffered parity, a matching report, or the next libarchive re-port.
Land it after #36542 or #44425.

### Verified by me after the review
- Real GNU tar 1.35 output reproduces it (repro-real-tar.mjs; the file must have holes ON DISK or tar writes no map).
  gnu: "Truncated tar archive detected while reading sparse file data (at byte 1554 of unknown)"; posix: "(at byte 3610 of unknown)".
- Trailing-hole member (check-hole.mjs): main, cut outside map: exit 0, m.bin 41472 bytes instead of 300000 (short, #36542 fixes).
  main, cut inside map: exit 1. Branch, cut inside map: exit 0 with the SHORT file. So the fix must not land before #36542/#44425.

### Should-fix list for a revival (from the review; none done yet on the branch)
1. Replay state: restore by snapshot, not by the four-field list. archive_format / archive_format_name and
   sparse_gnu_major/minor leak from a rolled-back attempt (seen on builds with mac-ext). Copy all scalar tar state +
   a->archive.archive_format(+name) at sequence start, put it back on rollback; keep strings, sparse list, sconv caches.
2. Pre-touch: in tar_read_header before `switch(header->typeflag[0])`, while header_deferring, for A g K L V x X whose
   512 + padded size fits the window: read-ahead the whole payload through the wrapper and re-fetch h. Without it
   header_pax_extension sees only a 512-byte view (did_read) when bytes come through the copy buffer, answers a pax key
   over 512 bytes with ARCHIVE_WARN, and the member installs under its ustar name (main installs the pax name).
   It also cuts replays to one per extension header.
3. Geometric replay gate: on rollback set header_need = max(header_need, min(2 * bytes buffered, LIMIT)). Today every
   arriving piece re-parses: 120 re-parses / 1.8 GiB for a 30 MiB sparse map at the 256 KiB drain threshold (5.5 s;
   86 s in 16 KiB pieces).
4. tar_header_commit: skip the consume when a->filter->fatal (it overwrites the real error with "Truncated input file").
5. gzip: FEXTRA guard in consume_header before the consume:
   if (__archive_read_filter_ahead(f->upstream, len, &avail) == NULL && avail == ARCHIVE_RETRY) return (ARCHIVE_RETRY);
   plus a test row (bgzip-style header, cut inside the extra field).
6. Tests: assert the whole extracted tree (readdirSorted of node_modules/sparse-pkg), not only m.bin; add a 0.0 sparse
   map without numblocks; add a trailing-hole member cut inside its map (after #36542); consider a
   bun:internal-for-testing readTarballInPieces(tgz, cuts) beside readTarball (src/js/internal-for-testing.ts:201,
   pack_command.rs bindings.jsReadTarball) to sweep split offsets in-tree without the 100 ms hold.
7. Own the 1 MiB -> 32 MiB window change in the PR body with the measured worst case, or keep it near 1 MiB.
8. Sweep stale descriptions of the old mechanism (test file comment that names bun_retry, 4 more).
9. PR body: say it was found by audit, no report exists; name #36542 / #44425 / #44509 and the landing order.
10. Separate small PRs the review suggests: `!mac-ext` at the five tar option sites (removes the AppleDouble form, makes
    macOS output equal Linux); that one is a behaviour change on macOS and needs its own yes.
11. Unverified by me: the review says a crafted pax payload over 1 MiB makes MAIN exit 0 and install files the buffered
    extractor never writes (a silent stream != buffered divergence). Worth a private look.

## Parked (Oct 7)
- Tracking issue: https://github.com/oven-sh/bun/issues/44675 (repro with real GNU tar, messages, cause, branch pointer, open points).
- No PR. Work branch robobun/399843a7/tar-sparse-map-resume at f5681dc929 (has the defects listed in the should-fix list).
- Next step belongs to a maintainer: decide whether stream == buffered parity for sparse members / large pax headers is wanted.
