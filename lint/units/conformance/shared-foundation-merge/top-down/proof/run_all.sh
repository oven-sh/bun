#!/bin/bash
# Runs every verifier of the upper prototypes in one tree and keeps what each prints.
# usage: run_all.sh <tree: a copy of notes/lint/units/conformance> <output directory> [name filter]
# Needs: the ground-truth binaries of error-baseline-format (EBGT), of instance-materialisation (IMGT, IMPREFIX)
# and of oracle-and-expectations; absent binaries make the run of that verifier print the reason.
T=$(cd "$1" && pwd)
OUT=$2
FILTER=${3:-}
EBGT=${EBGT:-/tmp/sfm/ebf-gt/gt}
IMPREFIX=${IMPREFIX:-/tmp/sfm/im-prefix/gt}
REF=/workspace/ref/typescript-go
CASES=$REF/_submodules/TypeScript/tests/cases
mkdir -p "$OUT" /tmp/im
export BUN_DEBUG_QUIET_LOGS=1

run() {
  local name=$1 dir=$2
  shift 2
  if [ -n "$FILTER" ] && [[ "$name" != *$FILTER* ]]; then return; fi
  local start=$(date +%s)
  (cd "$T/$dir" && timeout 3000 "$@") > "$OUT/$name.out" 2>&1
  local code=$?
  echo "exit $code" >> "$OUT/$name.out"
  echo "$name: exit $code, $(( $(date +%s) - start ))s"
}

DG=directive-grammar
run dg-verify_cases $DG/prototype bun verify_cases.ts $CASES "$OUT/dg-cases.tsv"
if [ -f "$OUT/dg-cases.tsv" ]; then
  zcat "$T/$DG/vectors/cases.tsv.gz" | cmp - "$OUT/dg-cases.tsv" > "$OUT/dg-verify_cases.cmp" 2>&1 && echo "same as the Go file" >> "$OUT/dg-verify_cases.cmp"
fi
run dg-verify_vectors $DG/prototype bun verify_vectors.ts ../vectors/synthetic-inputs.json "$OUT/dg-synth.json"

EN=enumerator
zcat "$T/$EN/vectors/paths-sample.tsv.gz" > "$OUT/paths-sample.tsv"
zcat "$T/$EN/vectors/skip-reasons.tsv.gz" > "$OUT/skip-reasons.tsv"
run en-verify_counts $EN/prototype bun verify_counts.ts
run en-verify_names $EN/prototype bun verify_names.ts
run en-verify_paths $EN/prototype bun verify_paths.ts "$OUT/paths-sample.tsv"
run en-verify_reasons $EN/prototype bun verify_reasons.ts "$OUT/skip-reasons.tsv"

EP=error-baseline-format/prototype
run ebp-crosscheck-corpus $EP bun crosscheck.ts corpus $EBGT
run ebp-crosscheck-fuzz $EP bun crosscheck.ts fuzz $EBGT 3000 1
run ebp-crosscheck-fuzz-mild $EP bun crosscheck.ts fuzz $EBGT 3000 2 mild
run ebp-crosscheck_tsc $EP bun crosscheck_tsc.ts 2000 1
run ebp-crosscheck_tsc-mild $EP bun crosscheck_tsc.ts 2000 2 mild
run ebp-readerfuzz $EP bun readerfuzz.ts 2000 1
run ebp-roundtrip $EP bun roundtrip.ts all auto order
run ebp-selfcheck $EP bun selfcheck.ts
run ebp-verify_units-go $EP bun verify_units.ts go
run ebp-verify_units-ts $EP bun verify_units.ts ts

ET=error-baseline-format/top-down
run ebt-crosscheck_go-corpus $ET bun crosscheck_go.ts $EBGT corpus
run ebt-crosscheck_go-fuzz $ET bun crosscheck_go.ts $EBGT fuzz 5000 12345
run ebt-crosscheck_go-wild $ET bun crosscheck_go.ts $EBGT wild 5000 777
run ebt-reader_fuzz-sane $ET bun reader_fuzz.ts 5000 1 sane alone plain lf
run ebt-reader_fuzz-units $ET bun reader_fuzz.ts 5000 2 sane units plain all
run ebt-reader_fuzz-tricky $ET bun reader_fuzz.ts 5000 3 tricky units all all invalid
run ebt-roundtrip-go-tsgo $ET bun roundtrip.ts go tsgo
run ebt-roundtrip-go-tsgo-shape $ET bun roundtrip.ts go tsgo shape
run ebt-roundtrip-ts-tsc $ET bun roundtrip.ts ts tsc
run ebt-roundtrip-ts-tsc-shape $ET bun roundtrip.ts ts tsc shape
run ebt-roundtrip-ts-tsgo $ET bun roundtrip.ts ts tsgo
run ebt-roundtrip-godiff-tsgo $ET bun roundtrip.ts godiff tsgo
run ebt-check_units-go $ET bun check_units.ts go
run ebt-check_units-ts $ET bun check_units.ts ts
run ebt-examples $ET bun examples.ts
run ebt-ties $ET bun ties.ts

IM=instance-materialisation
run im-verify_vectors $IM/prototype bun verify_vectors.ts ../vectors/vectors.json.gz ../vectors/expected.json.gz
run im-verify_split-tsgo $IM/prototype bun verify_split.ts tsgo
run im-verify_split-ts $IM/prototype bun verify_split.ts ts
run im-verify_prefix $IM/prototype bun verify_prefix.ts $IMPREFIX
run im-verify_materialise $IM/prototype bun verify_materialise.ts "$OUT/mat"
rm -rf "$OUT/mat"
run imt-verify_paths $IM/top-down/prototype bun verify_paths.ts
run imt-to_file_name_lower_case $IM/top-down/prototype bun to_file_name_lower_case.ts
run imt-verify_roots $IM/top-down/prototype bun verify_roots.ts
run imt-verify_materialize $IM/top-down/prototype bun verify_materialize.ts

OE=oracle-and-expectations
run oe-expectations.test $OE/bottom-up/prototype bun test --timeout 180000 ./expectations.test.ts
run oe-verify_list $OE/bottom-up/prototype bun verify_list.ts
run oe-selfcheck $OE/top-down/prototype bun selfcheck.ts

CC=check-contract-default-spawn
run cc-spawn.test $CC/prototype bun test --timeout 180000 ./spawn.test.ts
run cc-verify_plain $CC/prototype bun verify_plain.ts
run cct-manifest.test $CC/top-down bun test --timeout 180000 ./manifest.test.ts
run cct-plain.test $CC/top-down bun test --timeout 180000 ./plain.test.ts
run cct-spawn.test $CC/top-down bun test --timeout 180000 ./spawn.test.ts

TF=test-file-and-sweep
run tf-conformance.test $TF/top-down bun test --timeout 180000 ./conformance.test.ts
run tfb-proto.test $TF/bottom-up/prototype bun test --timeout 180000 ./proto.test.ts
run tfb-proto2.test $TF/bottom-up/prototype bun test --timeout 180000 ./proto2.test.ts
echo "done: $OUT"
