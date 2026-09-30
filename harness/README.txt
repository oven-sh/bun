Measurement harness for the node:events / process emitter work (not for merge).

  cc -O2 -o icount icount.c
  bun ee-icount.mjs --a <bun-profile A> --b <bun-profile B> --cases hot|cold --tiers ftl,dfg,base,llint

icount single-steps the main thread (ptrace) between calls of Bun.nanoseconds() and counts instructions.
