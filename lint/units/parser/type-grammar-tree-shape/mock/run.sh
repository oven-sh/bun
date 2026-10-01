#!/bin/sh
# usage: run.sh <corpus.txt> <tag>  -> work/og<tag>.out work/ng<tag>.out and the summary
cd /tmp/p12/mock
timeout 200 ./build/og $1 > /tmp/p12/work/og$2.out; echo "og exit $?"
timeout 200 ./build/ng $1 > /tmp/p12/work/ng$2.out; echo "ng exit $?"
python3 /tmp/p12/work/cmp.py /tmp/p12/work/og$2.out /tmp/p12/work/ng$2.out | grep "^===\|^tokens"
