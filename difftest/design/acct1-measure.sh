#!/bin/bash
# usage: measure.sh <bin> <tar-name> ; prints vector for load-only, first and second extraction
BIN=$1; T=$2
DEST=/tmp/acct1-knh/dest-$T
rm -rf "$DEST"
L=$(/tmp/arc/sc "$BIN" /tmp/arc/count.mjs /tmp/acct1-knh/tars/$T.tar "$DEST" 0 2>&1 | grep '^SC')
F=$(/tmp/arc/sc "$BIN" /tmp/arc/count.mjs /tmp/acct1-knh/tars/$T.tar "$DEST" 1 2>&1 | grep '^SC')
S=$(/tmp/arc/sc "$BIN" /tmp/arc/count.mjs /tmp/acct1-knh/tars/$T.tar "$DEST" 1 2>&1 | grep '^SC')
echo "$T load : $L"
echo "$T first: $F"
echo "$T secnd: $S"
rm -rf "$DEST"
