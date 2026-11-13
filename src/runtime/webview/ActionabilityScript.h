#pragma once

#include <wtf/text/ASCIILiteral.h>

namespace Bun {

// The page-side half of click(selector), for both backends. test/js/bun/webview/click-selector-pages.ts has a page for each clause, and says which fact of a browser or a library the clause is for.
constexpr ASCIILiteral kActionabilityIIFE = R"js((async (sel, timeout) => {
const deadline = performance.now() + timeout;
const starting = a => {
  const now = a.timeline?.currentTime;
  const begun = now - a.startTime - (a.playbackRate < 0 ? a.effect?.getComputedTiming().endTime / a.playbackRate : 0);
  return now != null && (a.pending || (begun > -150 && begun < 8));
};
let last, framed, ts;
for (;;) {
  const el = document.querySelector(sel);
  if (el && framed) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (r.width > 0 && r.height > 0 && cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight) {
      const seen = { l: r.left, t: r.top, w: r.width, h: r.height, ts };
      if (!last || last.l !== seen.l || last.t !== seen.t || last.w !== seen.w || last.h !== seen.h) last = seen;
      else if (!(ts - last.ts < 8) || performance.now() - (last.stuck ??= performance.now()) >= 100) {
        const hit = document.elementFromPoint(cx, cy);
        if (hit === el || el.contains(hit)) {
          if (!last.found) {
            last.found = [], last.more = 8;
            try {
              const scopes = [document], path = new Set();
              for (let n = el; n && n !== document && !path.has(n); n = n.nodeType === 11 ? n.host : n.assignedSlot || n.parentNode) path.add(n), n.nodeType === 11 && scopes.push(n);
              last.found = scopes.flatMap(scope => scope.getAnimations()).filter(starting);
            } catch {}
          }
          if (!last.found.length) return [cx, cy];
          if (!last.found.some(starting) || !last.more--) last = { ...seen, found: [] };
        }
      }
    } else last = undefined;
  } else last = undefined;
  if (performance.now() > deadline) throw "timeout waiting for '" + sel + "' to be actionable";
  ts = await new Promise(f => requestAnimationFrame(f));
  framed = true;
}
}))js"_s;

} // namespace Bun
