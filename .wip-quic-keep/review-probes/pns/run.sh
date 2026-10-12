#!/bin/bash
# usage: run.sh <name> <bin> [ENV=...]
name=$1; bin=$2; shift 2
cd /tmp/pns_probe
env "$@" SERVER_BIN=$bin BUN_DEBUG_lsquic=1 BUN_DEBUG_QUIET_LOGS=1 timeout 150 $bin /tmp/pns_probe/client.mjs > $name.out 2> $name.err
echo "$name exit=$?"
python3 - "$name" <<'PY'
import json,sys
n=sys.argv[1]
try:
    d=json.load(open(f'/tmp/pns_probe/{n}.out'))
except Exception as e:
    print("no json:", e); sys.exit(0)
print({k:d[k] for k in ['DIRECTION','PAUSE_MS','OUTAGE_MS','serverPacketsDropped','outageStart','outageEnd','openedAt','closedAt','closeError','early','streamBytes','stats']})
print(' received(server):', d['received'])
print(' statuses(client):', d['statuses'])
print(' clientPackets:', d['clientPackets'])
PY
