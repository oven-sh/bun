#pragma once

#include <wtf/text/ASCIILiteral.h>

namespace Bun {

// The page-side half of click(selector), for both backends. An async function of (sel, timeout) that looks at the
// element once per animation frame and returns its centre [cx, cy] when it is actionable: attached, has a size, centre
// inside the viewport, the same box at two looks, topmost at its centre. It throws on timeout.
//
// Equal boxes do not always mean that the element is still:
// - Before the first frame nothing is sampled. That look and the next one can share a frame.
// - The second look counts when its frame stamp is 8 ms later, half a 60 Hz frame. After a long task two callbacks
//   get one frame. A stamp that stands still (a paused animation clock) counts after 100 ms.
// - An animation that has yet to start holds its element at the first keyframe. Those found at the second look, on
//   the element or an ancestor, are waited for, and then one more frame. The search is not repeated for that box, so
//   a page that begins an animation in every frame cannot hold a still element until the timeout.
constexpr ASCIILiteral kActionabilityIIFE = R"js((async (sel, timeout) => {
const deadline = performance.now() + timeout;
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
          last.starting ??= document.getAnimations().filter(a => a.pending && a.timeline?.currentTime != null && a.effect?.target?.contains?.(el));
          if (!last.starting.length) return [cx, cy];
          if (!last.starting.some(a => a.pending)) last = { ...seen, starting: [] };
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
