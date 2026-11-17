#!/bin/bash
# identical.sh : for a list of symbol patterns, prints the instruction count in both builds and whether the normalized disassembly is the same.
cd /tmp/repro-9089
llvm-nm --defined-only bin/bun-profile-base > /tmp/repro-9089/nm-base.txt
llvm-nm --defined-only bin/bun-profile-new > /tmp/repro-9089/nm-new.txt
norm() { sed -E 's/<[^>]*>/<SYM>/g; s/\$0x[0-9a-f]{5,}/$ADDR/g; s/# imm = 0x[0-9A-F]+//; s/\.llvm\.[0-9]+//g'; }
while read -r label pattern; do
  sb=$(grep -E "$pattern" nm-base.txt | awk '{print $3}' | head -1)
  sn=$(grep -E "$pattern" nm-new.txt | awk '{print $3}' | head -1)
  if [ -z "$sb" ] || [ -z "$sn" ]; then echo "$label: MISSING base=${sb:0:40} new=${sn:0:40}"; continue; fi
  ./dis.sh bin/bun-profile-base "$sb" | norm > /tmp/repro-9089/id-b.s
  ./dis.sh bin/bun-profile-new "$sn" | norm > /tmp/repro-9089/id-n.s
  nb=$(wc -l < id-b.s); nn=$(wc -l < id-n.s)
  if cmp -s id-b.s id-n.s; then echo "$label: SAME ($nb)"; else echo "$label: DIFFERENT ($nb -> $nn), $(diff id-b.s id-n.s | grep -c '^[<>]') changed lines"; fi
done <<'LIST'
deepMatch<false> _Z14Bun__deepMatchILb0E
deepMatch<true> _Z14Bun__deepMatchILb1E(LN3Bun13DeepMatchWalkE0E)?EbN
matchAsymmetricMatcherAndGetFlags matchAsymmetricMatcherAndGetFlags
matchAsymmetricMatcher _ZL22matchAsymmetricMatcher
Expect_readFlagsAndProcessPromise  Expect_readFlagsAndProcessPromise$
jestDeepMatch  JSC__JSValue__jestDeepMatch$
toMatchObject-closure Bun__Bindgen__ExpectPrototype__toMatchObject00
jest_deep_match-rust 7JSValue15jest_deep_match
Pass::once expect_deferredNtB[0-9a-zA-Z_]*4Pass4once
call_matcher Expect12call_matcher
execute_custom_matcher execute_custom_matcher
matchedRowsFrom _ZN3Bun15matchedRowsFromEPN3JSC14JSGlobalObjectERNS_14DeepMatchStateENS0_7JSValueES5_
functionBunDeepMatch _ZN3Bun20functionBunDeepMatchEPN3JSC14JSGlobalObjectEPNS0_9CallFrameE
toMatchObject-host _Z39jsExpectPrototypeFunction_toMatchObjectPN3JSC14JSGlobalObjectEPNS_9CallFrameE
snapshot-rust match_and_fmt_snapshot|to_match_snapshot
LIST
