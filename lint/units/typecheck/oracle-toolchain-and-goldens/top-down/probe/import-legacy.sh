#!/bin/sh
# Copies the main programs of the separate research probes into sub/<name>/main.go as packages of the one probe program.
# Only three things change: the package name, `func main` becomes `func Main`, and the scratch import path of the leaf probes.
# The results are stored in sub/, so this script only documents where each file came from. Run it again after a source changes.
# usage: sh import-legacy.sh
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
N=$(cd "$HERE/../../.." && pwd)
take() {
  mkdir -p "$HERE/sub/$1"
  { echo "// Imported from units/typecheck/$2 by import-legacy.sh. Do not edit here."; sed -e "s/^package main\$/package $1/" -e 's/^func main() {$/func Main() {/' -e 's#"golden/#"github.com/microsoft/typescript-go/internal/#' "$N/$2"; } > "$HERE/sub/$1/main.go"
}
take tree ts-dump-and-test-importer/groundtruth/dumpast/main.go
take bind binder-port-and-fixtures/groundtruth/dumpbind/main.go
take initp checker-core-scratch/groundtruth/initprobe_main.go.txt
take k4 checker-type-layers-scratch/groundtruth/k4probe_main.go.txt
take rel checker-relations-and-inference/groundtruth/relprobe_main.go.txt
take decl checker-declarations-grammar-jsx/bottom-up/groundtruth/declprobe_main.go.txt
take pien checker-declarations-grammar-jsx/top-down/probes/pienprobe_main.go.txt
take printrt checker-type-printer/bottom-up/groundtruth/ctpprobe_main.go.txt
take printtypes checker-type-printer/bottom-up/groundtruth/ctpprobe2_main.go.txt
take printdecls checker-type-printer/bottom-up/groundtruth/ctpprobe3_main.go.txt
take printclone checker-type-printer/top-down/groundtruth/rtprobe_main.go.txt
take diagfmt diagnostics-groundtruth/gt/main.go
take leafdump leaf-packages-scratch/golden/dump/main.go
take leafdump2 leaf-packages-scratch/golden/dump2/main.go
take leafdump3 leaf-packages-scratch/golden/dump3/main.go
take leafchk leaf-packages-scratch/golden/chk/main.go
take tsc end-to-end-k4-k5/groundtruth/k4real_main.go.txt
# The expression probe is a library with Run(args): give it the same entry as the others.
mkdir -p "$HERE/sub/check"
{ echo "// Imported from units/typecheck/checker-expressions-calls-flow/bottom-up/groundtruth/src/zzprobe.go.txt by import-legacy.sh. Do not edit here."; sed -e 's/^package zzprobe$/package check/' "$N/checker-expressions-calls-flow/bottom-up/groundtruth/src/zzprobe.go.txt"; printf '\n// Main runs the probe on the arguments of the process.\nfunc Main() { Run(os.Args[1:]) }\n'; } > "$HERE/sub/check/main.go"
# The program recorder of the test harness lives inside the package of the harness.
{ echo "// Imported from units/typecheck/drivers-k4-k5/top-down/groundtruth/zz_k5.with-opts.go.txt by import-legacy.sh. Do not edit here."; cat "$N/drivers-k4-k5/top-down/groundtruth/zz_k5.with-opts.go.txt"; } > "$HERE/overlay/internal/testrunner/zz_k5.go"
echo "imported $(ls "$HERE/sub" | wc -l) sub-commands"
