import { monitorEventLoopDelay } from "node:perf_hooks";
const ways = {
  using() { let kept; { using h = monitorEventLoopDelay(); h.enable(); kept = h; } return kept.disable(); },
  async awaitUsing() { let kept; { await using h = monitorEventLoopDelay(); h.enable(); kept = h; } return kept.disable(); },
  inAFunction() { const close = x => { using y = x; }; const h = monitorEventLoopDelay(); h.enable(); close(h); close({ [Symbol.dispose]() {} }); return h.disable(); },
  notDisposed() { const h = monitorEventLoopDelay(); h.enable(); return h.disable(); },
};
for (const [name, way] of Object.entries(ways)) console.log(name, await way());
