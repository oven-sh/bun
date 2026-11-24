"use strict";
function make() { let list = []; return { add(v) { list[list.length] = v; }, scan(limit) { let c = 0; for (let i = 0; i < list.length; i++) { if (list[i] > limit) c++; } return c + ":" + list.length; } }; }
const box = make();
function step(r) { box.add((r * 7) % 11); return box.scan(r % 5); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
