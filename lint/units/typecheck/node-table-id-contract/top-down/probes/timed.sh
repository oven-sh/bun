#!/bin/bash
# Runs a command and prints wall, user and system time (the command and its children).
TIMEFORMAT='wall %R s; user %U s; sys %S s'
time "$@" > /tmp/ntc-td/timed.out 2>&1
grep -E "Finished|^error|test result" /tmp/ntc-td/timed.out | head -3
