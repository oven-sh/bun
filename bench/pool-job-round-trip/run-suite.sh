#!/bin/sh
# Final interleaved measurements: main (base) against the branch (fix). usage: BASE=<bun of main> FIX=<bun of the branch> run-suite.sh <results dir> [section ...]
# Sections: chains carriers long burst think contention build (default: all).
cd "$(dirname "$0")"
R=$1; shift
mkdir -p $R
SECTIONS="${*:-chains carriers long burst think contention build}"
: "${BASE:?path of the release build of main}" "${FIX:?path of the release build of the branch}"
V="base=$BASE fix=$FIX"
A=ab.py
steal() { head -1 /proc/stat | awk '{print $9}'; }
has() { case " $SECTIONS " in *" $1 "*) return 0;; esac; return 1; }
echo "start $(date) steal=$(steal) load=$(cut -d' ' -f1-3 /proc/loadavg) sections=$SECTIONS fix=$FIX" >> $R/meta.txt

if has chains; then
  : > $R/chains-awake.txt; : > $R/chains-normal.txt
  for cpus in 0 0-1 0-3 0-7 0-11; do
    for op in nodeHkdf fsStat fsReadFile subtleHmac; do
      python3 $A 7 $cpus awake chain.mjs $op 3000 -- $V >> $R/chains-awake.txt
      python3 $A 9 $cpus normal chain.mjs $op 3000 -- $V >> $R/chains-normal.txt
    done
  done
  echo "chains done $(date) steal=$(steal)" >> $R/meta.txt
fi

if has carriers; then
  : > $R/carriers.txt
  for op in bunFileBytes bunFileText gzip4k fsWriteFile randomBytes subtleDigest4096; do
    python3 $A 7 0-3 awake chain.mjs $op 2000 -- $V >> $R/carriers.txt
    python3 $A 7 0-3 normal chain.mjs $op 2000 -- $V >> $R/carriers.txt
  done
  echo "carriers done $(date) steal=$(steal)" >> $R/meta.txt
fi

if has long; then
  : > $R/long.txt
  for op in scrypt_100us scrypt_1ms; do
    for cpus in 0-3 0-11; do
      python3 $A 7 $cpus awake chain.mjs $op 1000 -- $V >> $R/long.txt
      python3 ab.py 7 $cpus awake2 chain.mjs $op 1000 -- $V >> $R/long.txt
      python3 $A 7 $cpus normal chain.mjs $op 1000 -- $V >> $R/long.txt
    done
  done
  echo "long done $(date) steal=$(steal)" >> $R/meta.txt
fi

if has burst; then
  : > $R/burst.txt
  for a in "nodeHkdf 2 2000" "fsReadFile 2 2000" "nodeHkdf 8 1000" "nodeHkdf 64 300" "nodeHkdf 1000 30" "fsReadFile 64 300" "scrypt_1ms 4 100" "scrypt_1ms 8 60" "scrypt_1ms 24 40" "deflate_256k 4 60"; do
    python3 $A 9 0-11 normal burst.mjs $a -- $V >> $R/burst.txt
    python3 $A 7 0-11 awake burst.mjs $a -- $V >> $R/burst.txt
    python3 $A 9 0-3 normal burst.mjs $a -- $V >> $R/burst.txt
  done
  for ch in 2 4 16; do
    python3 $A 7 0-11 awake chain.mjs nodeHkdf 2000 0 $ch -- $V >> $R/burst.txt
    python3 $A 9 0-11 normal chain.mjs nodeHkdf 2000 0 $ch -- $V >> $R/burst.txt
  done
  echo "burst done $(date) steal=$(steal)" >> $R/meta.txt
fi

if has think; then
  : > $R/think.txt
  for think in 5 20 100; do
    python3 $A 7 0-3 awake chain.mjs nodeHkdf 2000 $think -- $V >> $R/think.txt
    python3 $A 7 0-3 normal chain.mjs nodeHkdf 2000 $think -- $V >> $R/think.txt
  done
  echo "think done $(date) steal=$(steal)" >> $R/meta.txt
fi

if has contention; then
  : > $R/contention.txt
  for op in nodeHkdf fsStat; do
    python3 $A 7 0-3 hogs:4 chain.mjs $op 2000 -- $V >> $R/contention.txt
    python3 $A 7 0-3 hogs:8 chain.mjs $op 2000 -- $V >> $R/contention.txt
    python3 $A 7 0-11 hogs:12 chain.mjs $op 2000 -- $V >> $R/contention.txt
    python3 $A 7 0-11 hogs:24 chain.mjs $op 2000 -- $V >> $R/contention.txt
  done
  echo "contention done $(date) steal=$(steal)" >> $R/meta.txt
fi

if has build; then
  : > $R/build-api.txt
  python3 $A 7 0-11 normal build-api.mjs 1500 5 -- $V >> $R/build-api.txt
  python3 $A 5 0-11 awake build-api.mjs 1500 5 -- $V >> $R/build-api.txt
  echo "build-api done $(date) steal=$(steal)" >> $R/meta.txt
fi
echo "end $(date) steal=$(steal) load=$(cut -d' ' -f1-3 /proc/loadavg)" >> $R/meta.txt
