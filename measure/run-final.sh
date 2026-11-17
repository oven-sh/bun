#!/bin/bash
cd /tmp/repro-9089
./measure/run-measure4.sh insns > measure-insns.txt 2>&1
./measure/run-measure4.sh calls > measure-calls.txt 2>&1
echo done > measure-done.flag
