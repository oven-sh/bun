// STATISTIC: RoomAskedAsFarAsAProfileMayAsk >= 1
"use strict";
function row(first, text, above) { const cur = [first]; for (let j = 1; j <= text.length; j++) cur[j] = Math.min(above[j] + 1, cur[j - 1] + 1); return cur; }
function step(r) { const text = "abcdefghijklmnopqrstuvwxyz0123456789".slice(0, r * 3); const above = []; for (let k = 0; k <= text.length; k++) above.push(k * 2); const l = row(r, text, above); return l.length + ":" + l[l.length - 1] + ":" + l.join("").length; }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
