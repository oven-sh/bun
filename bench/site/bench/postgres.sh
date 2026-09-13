#!/bin/bash
# bench/postgres/index.mjs (100k `SELECT ... LIMIT 100` queries, 100 in flight) for bun / bun-release / node / deno.
# Starts a private PostgreSQL from $SITEBENCH_PGDATA (default $SITEBENCH_HOME/pgdata, trust auth, 127.0.0.1:$PGPORT) and
# stops it afterwards; set SITEBENCH_PG_EXTERNAL=1 to use an already-running server via the PG* variables instead.
# Reports wall time, the driver-reported time, and peak RSS.
source "$(dirname "${BASH_SOURCE[0]}")/../env.sh"
export PGHOST=${PGHOST:-127.0.0.1} PGPORT=${PGPORT:-5432} PGUSER=${PGUSER:-$USER} PGDATABASE=${PGDATABASE:-postgres}
export DATABASE_URL=postgres://$PGUSER@$PGHOST:$PGPORT/$PGDATABASE
if [ "${SITEBENCH_PG_EXTERNAL:-}" != 1 ]; then
  PG_BIN=${PG_BIN:-$(dirname "$(command -v pg_ctl)")}
  PGDATA=${SITEBENCH_PGDATA:-$S/pgdata}
  [ -f "$PGDATA/PG_VERSION" ] || "$PG_BIN/initdb" -D "$PGDATA" -U "$PGUSER" --auth=trust > "$S/pg-initdb.log" 2>&1
  "$PG_BIN/pg_ctl" -D "$PGDATA" -o "-p $PGPORT -k $TMP -c listen_addresses=$PGHOST -c max_connections=200" -l "$S/pg.log" start > /dev/null
  trap '"$PG_BIN/pg_ctl" -D "$PGDATA" stop -m fast > /dev/null 2>&1' EXIT
fi
for i in $(seq 1 40); do pg_isready -h "$PGHOST" -p "$PGPORT" -q && break; sleep 0.25; done
psql -c "select version()" -tA
cd "$BENCH_DIR/postgres"
RES=$OUT/postgres.txt; : > "$RES"
run() { local name="$1"; shift
  for r in $(seq 1 $RUNS); do
    local t0=$(date +%s%N)
    $GNU_TIME -f "%M" -o "$TMP/pg-rss.txt" "$@" index.mjs > "$TMP/pg.log" 2>&1; local rc=$?
    local t1=$(date +%s%N)
    printf "%-32s r%s wall=%sms  %s  peak_rss=%sMB  rc=%s\n" "$name" "$r" "$(( (t1-t0)/1000000 ))" "$(grep -E "Bun.sql|postgres:" "$TMP/pg.log" | tail -1 | tr -d '\n')" "$(( $(tail -1 "$TMP/pg-rss.txt") / 1024 ))" "$rc" | tee -a "$RES"
    [ $rc = 0 ] || tail -3 "$TMP/pg.log"
  done
}
run "$BUN_LABEL Bun.sql"          $BUN
run "$BUN_RELEASE_LABEL Bun.sql"  $BUN_RELEASE
run "$NODE_LABEL postgres.js"     $NODE
run "$DENO_LABEL postgres.js"     $DENO run -A
echo POSTGRES_DONE | tee -a "$RES"
