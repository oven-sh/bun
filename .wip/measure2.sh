#!/bin/bash
# usage: measure2.sh <bun binary> <label>
# Counts syscalls of `bunx` with the ptrace logger. Needs the probe registry (/tmp/probe/port).
. /tmp/probe/env.sh
BIN=$1
L=$2
S=/tmp/probe/sysl
OUT=/tmp/probe/m2-$L
rm -rf $OUT; mkdir -p $OUT

pj() { printf '{"name":"%s","version":"1.0.0"%s}' "$1" "$2"; }

# trace <world> <cwd> <log> args...   (runs bunx under the logger)
trace() {
  local W=/tmp/probe/$1 CWD=$2 LOG=$3; shift 3
  (cd $W/project/$CWD && env -u XDG_CONFIG_HOME -u XDG_CACHE_HOME -u BUN_INSTALL -u BUN_INSTALL_CACHE_DIR -u BUN_OPTIONS -u npm_config_registry -u NPM_CONFIG_REGISTRY -u BUN_CONFIG_REGISTRY HOME=$W/home TMPDIR=$W/tmp BUN_TMPDIR=$W/tmp BUN_DEBUG_QUIET_LOGS=1 NO_COLOR=1 $S $LOG "$BIN" "$@" > $LOG.out 2>&1)
  echo "exit=$?" >> $LOG.out
}

# summarize <log> <world> warm|cold
summarize() {
  local LOG=$1 W=/tmp/probe/$2
  local root=$(head -1 $LOG | cut -d' ' -f1)
  local child=$(grep -m1 "^$root FORK" $LOG | awk '{print $3}')
  local root_total=$(grep "^$root EXIT" $LOG | sed 's/.*total=//')
  local root_paths=$(grep -c "^$root [a-z]" $LOG)
  local root_project=$(grep "^$root [a-z]" $LOG | grep -c " $W/project")
  echo "  parent: total=$root_total path=$root_paths on_project_paths=$root_project"
  if [ "$3" = cold ] && [ -n "$child" ] && grep -q "^$child execve 0" $LOG; then
    local child_total=$(grep "^$child EXIT" $LOG | sed 's/.*total=//')
    local child_paths=$(grep -c "^$child [a-z]" $LOG)
    local in_project=$(grep "^$child [a-z]" $LOG | grep -c " $W/project")
    local wr_project=$(grep "^$child open" $LOG | grep " $W/project" | grep -cE "flags=0[0-7]*[1-3]$|flags=0[0-7]*[1-7][0-7][0-7]$" )
    echo "  child : total=$child_total path=$child_paths on_project_paths=$in_project write_opens_in_project=$wr_project"
  fi
}

setup() { # setup <world> <ncfg>   project root = project/, cwd = project/a/b/c
  mkworld $1; local P_=/tmp/probe/$1/project
  pj proj > $P_/package.json; mkdir -p $P_/a/b/c
  [ $2 -ge 1 ] && printf '[install]\nregistry = "http://127.0.0.1:%s/PROJECT/"\n' $P > $P_/bunfig.toml
  [ $2 -ge 2 ] && printf '@probe:registry=http://127.0.0.1:%s/SCOPE/\n' $P > $P_/.npmrc
  [ $2 -ge 3 ] && printf 'FOO=1\n' > $P_/.env
  return 0
}

echo "##### $L ($BIN)"
for spec in px-probe px-probe@1.0.0; do
  for n in 0 1 2; do
    w=w$n; setup $w $n
    runbun $w a/b/c $BIN x $spec > $OUT/$w.cold.out 2>&1   # cold install, not traced
    trace $w a/b/c $OUT/$w-$spec.log x $spec
    echo "warm, bunx $spec, 3 levels below a root with $n config file(s): $(tail -2 $OUT/$w-$spec.log.out | tr '\n' ' ')"
    summarize $OUT/$w-$spec.log $w warm
  done
done

w=c-none; mkworld $w
trace $w . $OUT/$w.log x px-probe
echo "cold, no package.json: $(tail -2 $OUT/$w.log.out | tr '\n' ' ')"; summarize $OUT/$w.log $w cold
for n in 0 2 3; do
  w=c$n; setup $w $n
  trace $w a/b/c $OUT/$w.log x px-probe
  echo "cold, 3 levels below a root with $n config file(s): $(tail -2 $OUT/$w.log.out | tr '\n' ' ')"; summarize $OUT/$w.log $w cold
done
