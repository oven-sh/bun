#!/bin/bash
# usage: measure.sh <bun binary> <label>
# Counts syscalls of `bunx` with the ptrace logger. Needs the scratch registry (/tmp/probe/port).
. /tmp/probe/env.sh
BIN=$1
L=$2
S=/tmp/probe/sysl
OUT=/tmp/probe/m-$L
rm -rf $OUT; mkdir -p $OUT

pj() { printf '{"name":"%s","version":"1.0.0"%s}' "$1" "$2"; }

# trace <world> <cwd> <log> args...   (runs bunx under the logger)
trace() {
  local W=/tmp/probe/$1 CWD=$2 LOG=$3; shift 3
  (cd $W/project/$CWD && env -u XDG_CONFIG_HOME -u XDG_CACHE_HOME -u BUN_INSTALL -u BUN_INSTALL_CACHE_DIR -u BUN_OPTIONS -u npm_config_registry -u NPM_CONFIG_REGISTRY -u BUN_CONFIG_REGISTRY HOME=$W/home TMPDIR=$W/tmp BUN_TMPDIR=$W/tmp BUN_DEBUG_QUIET_LOGS=1 NO_COLOR=1 $S $LOG "$BIN" "$@" > $LOG.out 2>&1)
  echo "exit=$?" >> $LOG.out
}

# summarize <log> <world>
summarize() {
  local LOG=$1 W=/tmp/probe/$2
  local root=$(head -1 $LOG | cut -d' ' -f1)
  # the `bun add` child: the first forked pid that execs the bun binary with a FORK line from root
  local child=$(grep -m1 "^$root FORK" $LOG | awk '{print $3}')
  local root_total=$(grep "^$root EXIT" $LOG | sed 's/.*total=//')
  local root_paths=$(grep -c "^$root [a-z]" $LOG)
  local root_cfg=$(grep "^$root [a-z]" $LOG | grep -cE "/(bunfig\.toml|\.npmrc)( |$)")
  echo "  parent: total_syscalls=$root_total path_syscalls=$root_paths config_file_syscalls=$root_cfg"
  grep "^$root [a-z]" $LOG | grep -E "/(bunfig\.toml|\.npmrc)( |$)" | sed 's/^/    /'
  if [ "$3" = cold ] && [ -n "$child" ] && grep -q "^$child execve 0" $LOG; then
    local child_total=$(grep "^$child EXIT" $LOG | sed 's/.*total=//')
    local child_paths=$(grep -c "^$child [a-z]" $LOG)
    local in_project=$(grep "^$child [a-z]" $LOG | grep -c " $W/project")
    local wr_project=$(grep "^$child open" $LOG | grep " $W/project" | grep -cE "flags=0[0-7]*[1-3]$|flags=0[0-7]*[1-7][0-7][0-7]$" )
    local tree_cfg=$(grep "^$child [a-z]" $LOG | grep "/.bunx-" | grep -cE "/(bunfig\.toml|\.npmrc|\.env[a-z.]*)( |$)")
    echo "  child : total_syscalls=$child_total path_syscalls=$child_paths on_project_paths=$in_project write_opens_in_project=$wr_project config_opens_in_tree=$tree_cfg"
  fi
}

echo "##### $L ($BIN)"

# ---- warm runs: parent only
for n in 0 1 2 3; do
  w=warm$n; mkworld $w; P_=/tmp/probe/$w/project
  mkdir -p $P_/outer/inner
  pj inner > $P_/outer/inner/package.json
  [ $n -ge 1 ] && printf '[install]\nregistry = "http://127.0.0.1:%s/USER/"\n' $P > $P_/outer/inner/bunfig.toml
  [ $n -ge 2 ] && printf 'registry=http://127.0.0.1:%s/USER/\n' $P > $P_/outer/inner/.npmrc
  if [ $n -ge 3 ]; then pj outer > $P_/outer/package.json; printf '[install]\nregistry = "http://127.0.0.1:%s/USER/"\n' $P > $P_/outer/bunfig.toml; fi
  runbun $w outer/inner $BIN x px-probe > $OUT/$w.cold.out 2>&1   # cold install, not traced
  trace $w outer/inner $OUT/$w.log x px-probe
  echo "warm, $n listed config file(s): $(tail -2 $OUT/$w.log.out | tr '\n' ' ')"
  summarize $OUT/$w.log $w warm
done

# ---- cold runs: the `bun add` child
# flat: cwd has no package.json anywhere above
w=coldflat; mkworld $w
trace $w . $OUT/$w.log x px-probe
echo "cold, no package.json: $(tail -2 $OUT/$w.log.out | tr '\n' ' ')"; summarize $OUT/$w.log $w cold

# deep: cwd is 7 levels below the project root
w=colddeep; mkworld $w; P_=/tmp/probe/$w/project
pj proj > $P_/package.json; mkdir -p $P_/a/b/c/d/e/f/g
trace $w a/b/c/d/e/f/g $OUT/$w.log x px-probe
echo "cold, 7 levels below the root: $(tail -2 $OUT/$w.log.out | tr '\n' ' ')"; summarize $OUT/$w.log $w cold

# deep + config: the same with bunfig.toml, .npmrc and .env in the root
w=colddeepcfg; mkworld $w; P_=/tmp/probe/$w/project
pj proj > $P_/package.json; mkdir -p $P_/a/b/c/d/e/f/g
printf '[install]\nregistry = "http://127.0.0.1:%s/PROJECT/"\n' $P > $P_/bunfig.toml
printf 'email=a@b.c\n' > $P_/.npmrc; printf 'FOO=1\n' > $P_/.env
trace $w a/b/c/d/e/f/g $OUT/$w.log x px-probe
echo "cold, 7 levels below a root with bunfig.toml, .npmrc, .env: $(tail -2 $OUT/$w.log.out | tr '\n' ' ')"; summarize $OUT/$w.log $w cold

# workspace: member of a 20-package workspace
w=coldws; mkworld $w; P_=/tmp/probe/$w/project
pj root ',"workspaces":["packages/*"]' > $P_/package.json
for i in $(seq 1 20); do mkdir -p $P_/packages/p$i; pj p$i > $P_/packages/p$i/package.json; done
trace $w packages/p7 $OUT/$w.log x px-probe
echo "cold, member of a 20-package workspace: $(tail -2 $OUT/$w.log.out | tr '\n' ' ')"; summarize $OUT/$w.log $w cold
