#!/bin/bash
# usage: run-h1.sh <bin> [env...]
bin=$1; shift
(env "$@" BUN_DEBUG_QUIET_LOGS=1 timeout 150 $bin /tmp/hazard-1.mjs 2>&1 | grep -v "ExperimentalWarning\|trace-warnings" | python3 -c "
import sys, json
for line in sys.stdin:
    try: d=json.loads(line)
    except Exception: print(line.strip()[:300]); continue
    d['received']=[x for x in d['received'] if x!=99]
    d['statuses']={k:v for k,v in d['statuses'].items() if v!='acknowledged'}
    print(json.dumps(d))
"; echo "exit=${PIPESTATUS[0]}")
