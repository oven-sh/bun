// None of these loops is given room: what is held is the answers.
"use strict";
function fill(got, n) { try { for (let j = got.length; j < n; j++) got.push(j + 0.5); return got.length + ":" + got[got.length - 1]; } catch (e) { return e.constructor.name + got.length; } }
function step(r) { const got = r & 1 ? [1] : ["a", {}]; if (r % 5 === 4) Object.freeze(got); if (r % 5 === 3) Object.preventExtensions(got); if (r === 7) got.length = 0; return fill(got, 3 + r * 3); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
