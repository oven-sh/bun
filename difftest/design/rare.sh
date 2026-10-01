#!/bin/bash
# rare-path replay: count syscalls for one member over a pre-made link (private copy)
run() { # mode listfile setup-fn
  local MODE=$1 LIST=$2 SETUP=$3
  local W=/tmp/recon-knh/rare-w; rm -rf $W; mkdir -p $W/out $W/victim; echo -n ORIGINAL > $W/victim/f.txt
  $SETUP $W
  local L=$(/tmp/arc/sc ./replayA $MODE $LIST $W/out 0 2>&1 | grep '^SC')
  local F=$(/tmp/arc/sc ./replayA $MODE $LIST $W/out 1 2>&1 | grep -E '^SC|REJECT|eloop')
  echo "$MODE $(basename $LIST) [$SETUP]: load[$L]"
  echo "    run[$(echo $F)] victim=$(cat $W/victim/f.txt) victimdir=[$(ls $W/victim | tr '\n' ' ')] out=[$(cd $W/out && find . -mindepth 1 -printf '%p(%y) ' )]"
}
s_leaf_root() { ln -s ../victim/f.txt $1/out/cfg; }
s_leaf_nested() { mkdir $1/out/a; ln -s ../../victim/f.txt $1/out/a/cfg; }
s_parent() { ln -s ../victim $1/out/shared; }
s_none_root() { :; }
s_none_nested() { mkdir $1/out/a; }
s_none_parent() { mkdir $1/out/shared; }
printf 'f cfg\n' > l_leaf_root.list
printf 'f a/cfg\n' > l_leaf_nested.list
printf 'f shared/f.txt\n' > l_parent.list
for m in main atomic; do
  run $m l_leaf_root.list s_none_root; run $m l_leaf_root.list s_leaf_root
  run $m l_leaf_nested.list s_none_nested; run $m l_leaf_nested.list s_leaf_nested
  run $m l_parent.list s_none_parent; run $m l_parent.list s_parent
done
