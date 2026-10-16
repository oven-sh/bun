P=$(cat /tmp/probe/port)
DBG=/workspace/bun/build/debug/bun-debug
mkworld() { W=/tmp/probe/$1; chmod -R u+rwx $W 2>/dev/null; rm -rf $W; mkdir -p $W/home $W/tmp $W/project; echo "registry=http://127.0.0.1:$P/USER/" > $W/home/.npmrc; }
# runbun <world> <cwd-rel> <bun-binary> args...
runbun() {
  local W=/tmp/probe/$1 CWD=$2 BIN=$3; shift 3
  (cd $W/project/$CWD && env -u XDG_CONFIG_HOME -u XDG_CACHE_HOME -u BUN_INSTALL -u BUN_INSTALL_CACHE_DIR -u BUN_OPTIONS -u npm_config_registry -u NPM_CONFIG_REGISTRY -u BUN_CONFIG_REGISTRY HOME=$W/home TMPDIR=$W/tmp BUN_TMPDIR=$W/tmp BUN_DEBUG_QUIET_LOGS=1 NO_COLOR=1 $PRE "$BIN" "$@")
}
reqs() { sleep 0.2; sort -u /tmp/probe/requests.log | tr '\n' ';'; echo; : > /tmp/probe/requests.log; }
