#!/bin/bash
# usage: loop.sh <bin> <n> <parallel> <name> <stdio-json> [env...]
bin=$1; n=$2; par=$3; name=$4; stdio=$5; shift 5
seq 1 $n | env "$@" xargs -P $par -I{} sh -c "timeout 30 $bin /tmp/probe-order/read-in-exit.cjs $name '$stdio' 2>&1 || echo EXIT=\$?" | sort | uniq -c
