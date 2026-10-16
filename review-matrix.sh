#!/bin/bash
# usage: matrix.sh <bin>   one line per scenario
b=$1; cd /tmp/probe-r1
( timeout 20 $b /tmp/probe-r2/q1-lost-error.js 2>/tmp/probe-r2/e.txt | head -c 1048577 >/dev/null ); echo "q1 lost error          : $(tail -1 /tmp/probe-r2/e.txt | sed 's/first write returned false | //; s/second write returned false | //')"
( timeout 20 $b /tmp/probe-r2/q1b-false-success.js 2>/tmp/probe-r2/e.txt | head -c 1048577 >/dev/null ); echo "q1b false success      : $(tail -1 /tmp/probe-r2/e.txt)"
echo "fail-end (child.stdin) : $(timeout 30 $b fail-end.mjs close 2>&1 | tail -1)"
for args in "stdout-fail-end.js" "stdout-fail-end.js noend"; do ( timeout 20 $b $args 2>/tmp/probe-r2/e.txt | head -c 1 >/dev/null ); echo "$args|head -c1 : $(tail -1 /tmp/probe-r2/e.txt)"; done
( timeout 20 $b /tmp/probe-r2/console-end-nohandler.js 2>/tmp/probe-r2/e.txt; echo "exit code $?" >> /tmp/probe-r2/e.txt ) | head -c 1 >/dev/null; sleep 0.2; echo "Console+end+EPIPE      : $(tr '\n' ';' < /tmp/probe-r2/e.txt | cut -c1-60)"
( $b epipe2.js 2>/tmp/probe-r2/e.txt | true ); sleep 0.8; echo "epipe2 (reader gone)   : $(tail -1 /tmp/probe-r2/e.txt)"
echo "small-epipe            : $(timeout 20 $b small-epipe.mjs | tail -1)"
echo "small-end-epipe        : $(timeout 20 $b small-end-epipe.mjs | tail -1)"
echo "kid-exit exit          : $(timeout 20 $b kid-exit.mjs exit | tail -1)"
echo "kid-exit kill          : $(timeout 20 $b kid-exit.mjs kill | tail -1)"
echo "end-destroy            : $(timeout 30 $b end-destroy.mjs 2>&1 | tail -1)"
echo "destroy-pending        : $(timeout 30 $b /tmp/probe-r2/destroy-pending.mjs | tr '\n' ';')"
echo "destroy-pending-late   : $(timeout 30 $b /tmp/probe-r2/destroy-pending-late.mjs | tr '\n' ';')"
echo "als at spawn           : $(timeout 30 $b als.mjs)"
echo "als one turn later     : $(timeout 30 $b /tmp/probe-r2/als-late.mjs)"
echo "q2 tick order          : $(timeout 20 $b /tmp/probe-r2/q2-tick-order.mjs)"
echo "shared-throw           : $(timeout 20 $b shared-throw.js 2>&1 >/dev/null | tail -1)"
echo "user _write            : $(timeout 20 $b /tmp/probe-r2/user-underscore-write.js 2>&1 >/dev/null)"
echo "cork never / tick      : $(timeout 20 $b /tmp/probe-r2/q4-cork.js never 2>&1 >/dev/null) / $(timeout 20 $b /tmp/probe-r2/q4-cork.js tick 2>&1 >/dev/null)"
echo "ownKeys(process.stdout): $($b -e 'console.log(Reflect.ownKeys(process.stdout).length)')"
