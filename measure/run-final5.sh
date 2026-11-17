#!/bin/bash
cd /tmp/repro-9089
rm -f measure-done.flag
./measure/run-measure5.sh insns > measure-insns.txt 2>&1
./measure/run-measure5.sh calls > measure-calls.txt 2>&1
echo done > measure-done.flag
