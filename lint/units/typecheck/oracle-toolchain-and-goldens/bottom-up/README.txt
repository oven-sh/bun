oracle-toolchain-and-goldens, bottom-up pass. Everything of this pass is below this directory.
The sibling directory ../top-down belongs to the other pass of the same unit: this pass does not write there.

bootstrap.sh     pins typescript-go 89d5d5b and TypeScript 5848bc5, makes Go 1.26 and nine modules without the Go proxy
                 (each module tree is checked against the h1 hash of the reference's go.sum), builds ONE probe, tsgoprobe,
                 through `go build -overlay -modfile`; the reference tree is only read. TRACEALL=1, COVER=1: two more builds.
probe/           the sources of the probe: cmd/tsgoprobe (dispatcher), zzprobe/<sub-command> (the research probes of the
                 unit notes, package name and entry renamed, nothing else), checker|ast|testrunner|stringutil (files added to
                 packages of the reference), patch.py (the six reference files that are patched, as copies), tools/
replay.sh        makes every stored golden of the unit notes again with tsgoprobe and compares bytes; replay-report.txt
                 is its output (split_cases.py, cmpset.py, foldtree.py and replay-inputs/ belong to it)
FORMATS.txt      the three canonical texts: tree (.tsgo.txt), bind result (bind-dump v1), checker state (checker-state v1)
state/           the structural oracle: fixtures/, runs.txt, golden/*.state.txt, state.sh make|check|layers,
                 layers-summary.txt and layers-detail.txt (the K3 layers that each golden enters, by coverage)
bunprobe/        the probe that prints the tree of bun_js_parser::Parser::parse_only; bunprobe.sh builds it outside the
                 repository; bunprobe/out/ is its output on the 29 inputs of ../../bun-ast-lowering/probe/src
MANIFEST.tsv     every file planned below test/cli/lint/typecheck/ with producer, sizes, reader, committed or generated

astutil/         the ast utilities oracle: astutil.sh make|check, golden.tar.gz (37 dumps of tsgoprobe astutil -bind)

work directory: /tmp/oracle-bu by default: toolchain 270 MB, downloads 75 MB, modules 46 MB, 62 MB per binary, and a Go
build cache that grows by about 0.8 GB for every build of the probe (delete gocache/ when done). A cold build of the
probe takes 5 minutes under the machine lock, the three flavours 12; replay.sh 3 minutes, its suite set 2 more.
  bash bootstrap.sh && bash replay.sh && bash state/state.sh check
