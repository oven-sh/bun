#pragma once

#include <wtf/text/ASCIILiteral.h>

namespace Bun {

// The page-side half of click(selector), for both backends. An async function of (sel, timeout) that looks at the
// element once per animation frame and returns its centre [cx, cy] when it is actionable: attached, has a size, centre
// inside the viewport, the same box at two looks, topmost at its centre. It throws on timeout.
//
// Equal boxes do not always mean that the element is still:
// - Before the first frame nothing is sampled. That look and the next one can share a frame.
// - The second look counts when its frame time is at least 8 ms later: more than the 0.002 ms between the two frames
//   that Chrome runs after a long task, less than a frame at 120 Hz. A time that stands still (a paused animation
//   clock) counts after 100 ms.
// - An animation that has yet to start holds its element at the first keyframe. Chrome reports it as pending.
//   WebKit 18.4 reports it as started, at time 0. The ones found at the second look are waited for, for 8 frames at
//   most, and then one more frame. They are looked for in the whole document and in the shadow trees around the
//   element, because an animation of another element can push this one. The search is not repeated for that box. So
//   a page that begins an animation in every frame, or whose animation never starts, cannot hold a still element
//   until the timeout.
constexpr ASCIILiteral kActionabilityIIFE = R"js((async (sel, timeout) => {
const deadline = performance.now() + timeout;
const starting = a => a.pending ? a.timeline?.currentTime != null : a.timeline?.currentTime - a.startTime < 4;
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
            const scopes = [document], path = new Set();
            for (let n = el; n && !path.has(n); n = n.assignedSlot || n.parentNode || n.host) path.add(n), n.nodeType === 11 && scopes.push(n);
            last.found = scopes.flatMap(scope => scope.getAnimations()).filter(starting), last.more = 8;
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
