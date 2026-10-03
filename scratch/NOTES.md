# Scratch notes (session 399843a7)

Work branch: robobun/399843a7/tar-sparse-map-resume. Fix commit ec4698326b (patch + TarballStream.rs).
Design: tar header replay, opt-in via the "nonblocking" tar option (see /tmp/design.json -> scratch/design.json).

Restore the harness after a container reset:
  git fetch origin robobun/399843a7/scratch && git archive FETCH_HEAD scratch | tar -x -C /tmp && mv /tmp/scratch/la-harness /tmp/la-harness
  tar -xzf /root/.bun/build-cache/tarballs/libarchive-1a3a126350c6e47f.tar.gz -C /tmp/libarchive-orig --strip-components=1   (mkdir first)
  base = cp -r of vendor/libarchive/libarchive built from origin/main's patch; work = pristine + repo patch applied
  ./build.sh <srcdir> <out>; bun gen.mjs; ./sweep.sh <bin> '*' 12

Measurements (harness, ASAN build, libarchive at 27cbc78):
- sweep before (main's patch, first version of the corpus, 58 cases): 913 of 3168 plans differ from the single-read reference
- sweep after (opt-in replay, 92 cases x gzip level 0 and 6): plans=5052 with_mismatch=0 msg_only_plans=0
- single-read logs, main vs fix, option off and on, with and without mac-ext: 368 comparisons, 0 differ
- cost, edges executed in libarchive per run (trace-pc-guard), 2000 entries:
  ustar2000: main 1792901; fix option off 1796913 (+2/entry); fix option on 1811002 (+9/entry)
  pax2000:   main 9256413; fix option off 9226425 (-15/entry); fix option on 9232514 (-12/entry)
  mallocs per run: unchanged with the option off (8011 / 18019); option on: +1 (the option string copy)
  struct tar: +56 bytes
- patch: 1008 -> 834 lines, 44 -> 32 hunks
- e2e tests (8 cases) fail on the release build of main 367d939d9
