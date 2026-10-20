#!/bin/bash
BIN=$1; DECL=$2; N=$3
NM=/tmp/insn/$(basename $BIN).nm
D=$(mktemp -d)
grep -E ' [tT] (mi_malloc|mi_calloc|mi_realloc|mi_zalloc|mi_heap_malloc|mi_heap_zalloc|mi_malloc_aligned|mi_zalloc_aligned|mi_heap_malloc_aligned|mi_heap_zalloc_aligned|mi_realloc_aligned|mi_heap_realloc_aligned|mi_expand|posix_memalign|mi_free)$' "$NM" | awk '{print $1, $3}' | sort -u -k1,1 > "$D/entries"
F=$(awk '{printf "%s0x%s+0x1", (NR>1?",":""), $1}' "$D/entries")
python3 /tmp/insn/gen.py "$DECL" $N $D/s.css
qemu-x86_64 -d exec,nochain -dfilter "$F" -D "$D/log" "$BIN" build $D/s.css --outdir $D/out > /dev/null 2>&1
awk -v ENTRIES="$D/entries" 'BEGIN { while ((getline line < ENTRIES) > 0) { split(line, p, " "); e[p[1]] = p[2] } }
 { split($4, a, "/"); pc=a[2]; if (pc in e) c[e[pc]]++ } END { for (k in c) printf "%s=%d ", k, c[k]; printf "\n" }' "$D/log"
rm -rf $D
