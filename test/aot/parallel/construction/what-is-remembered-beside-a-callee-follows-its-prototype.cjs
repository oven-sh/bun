"use strict";
const hide = new Function("K", "return [K]");
function said(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }
const Made = hide(function (x) { this.x = x; })[0];
const first = Made.prototype;
first.named = "first";
const lines = [];
for (let round = 0; round < 4; round++) {
  for (let i = 0; i < 50; i++) new Made(i);
  lines.push(["as it began", new Made(1).named, Object.getPrototypeOf(new Made(1)) === Made.prototype]);
  const other = { named: "other " + round };
  Made.prototype = other;
  lines.push(["behind a store", new Made(2).named, Object.getPrototypeOf(new Made(2)) === other]);
  for (let i = 0; i < 50; i++) new Made(i);
  lines.push(["and it stays", new Made(3).named]);
  for (const nothing of [null, undefined, 7, "text", Symbol.iterator]) {
    Made.prototype = nothing;
    lines.push(["no object", typeof nothing, Object.getPrototypeOf(new Made(4)) === Object.prototype, new Made(4).named]);
  }
  Made.prototype = first;
  lines.push(["back", new Made(5).named, new Made(5) instanceof Made]);
  Object.setPrototypeOf(first, { above: "above " + round });
  lines.push(["what stands above it changes", new Made(6).above]);
  Made["added" + round] = round;
  lines.push(["a name is added to the callee", new Made(7).named, Made["added" + round]]);
  Made.prototype = Object.freeze({ named: "frozen" });
  lines.push(["a frozen one", new Made(8).named]);
  Made.prototype = first;
}
lines.push(["an accessor is refused", said(() => Object.defineProperty(Made, "prototype", { get() { return {}; } }))]);
Object.defineProperty(Made, "prototype", { writable: false });
lines.push(["no longer writable", said(() => { Made.prototype = {}; }), new Made(9).named]);
Object.freeze(Made);
lines.push(["the callee is frozen", new Made(10).named, new Made(10).x]);
for (const line of lines) console.log(line.join(" | "));
