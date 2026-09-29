#!/bin/bash
# usage: run-count.sh <base|pr> <fixture> <bun args...>
which=$1; fixture=$2; shift 2
f=/tmp/meas/nm-$which.txt
addr() { grep -F "$1" $f | grep -E "$2" | awk '{print $1}' | head -1; }
syms=""
add() { local a=$(addr "$2" "$3"); [ -n "$a" ] && syms="$syms${syms:+,}$1=0x$a"; }
add record_pm "PackageManager as bun_install::dependency::NpmAliasRegistry>::record_npm_alias" "."
add record_map "HashMap<u64, bun_install_types::resolver_hooks::DependencyVersion> as bun_install::dependency::NpmAliasRegistry>::record_npm_alias" "."
add insert " t <bun_collections::zig_hash_map::HashMap<u64, bun_install_types::resolver_hooks::DependencyVersion>>::insert" "insert$"
add grow " t <bun_collections::zig_hash_map::HashMap<u64, bun_install_types::resolver_hooks::DependencyVersion>>::grow" "grow$"
add to_version "as bun_install::dependency::VersionExt>::to_version" "."
add row_pass " t <bun_install::lockfile_real::Lockfile>::record_dependency_row_aliases" "aliases$"
add override_catalog_pass " t <bun_install::lockfile_real::Lockfile>::record_override_and_catalog_aliases" "aliases$"
work=$(mktemp -d /tmp/meas/work-XXXXXX)
cp -r /tmp/meas/fix/$fixture/. $work/
cd $work
COUNT_SYMS="$syms" BUN_DEBUG_QUIET_LOGS=1 BUN_INSTALL_CACHE_DIR=$work/.cache timeout 900 gdb -q -batch -readnever -x /tmp/meas/count.py --args /tmp/meas/bun-debug-$which "$@" 2>&1 | grep -E "^COUNTS" | head -3
rm -rf $work
