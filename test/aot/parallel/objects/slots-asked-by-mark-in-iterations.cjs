// Methods that loops reach by other deeds read several fields of objects that are not filled yet, have lost a field or were never constructed.
"use strict";
const out = [];
function Walker(text, early) {
  this.text = text;
  this.at = 0;
  if (early) this.early = this.copy(1);
  this.from = 0; this.till = 0; this.sort = "none"; this.wasFrom = -1; this.wasTill = -1; this.wasSort = "";
  this.log = [];
}
const deeds = Walker.prototype;
deeds.copy = function (by) { this.wasSort = this.sort; this.wasFrom = this.from; this.from = this.at; this.at += by; this.wasTill = this.till; this.till = this.at; return this.wasSort + this.wasTill + ":" + this.wasFrom + this.till + "-" + this.from; };
deeds.step = function (by) { const was = this.copy(by); this.sort = this.text[this.at] || "end"; return was + this.sort; };
deeds.run = function (turns) { let found = ""; for (let i = 0; i < turns; i++) found += this.step(1) + ";"; return found + Object.keys(this).join(); };
const show = (run) => { try { return String(run()); } catch (error) { return error.constructor.name + (error.message.includes("read") ? "" : ""); } };
const strange = [
  () => new Walker("abcdef"), () => new Walker("abcdef", true), () => Object.create(deeds), () => Object.setPrototypeOf({ at: 2, text: "xyz" }, deeds),
  () => { const s = new Walker("abc"); delete s.till; return s; }, () => { const s = new Walker("abc"); delete s.from; delete s.sort; s.from = 5; return s; },
  () => { const s = new Walker("abc", true); delete s.wasSort; delete s.at; return s; }, () => Object.freeze(new Walker("abc")), () => Object.seal(new Walker("abc", true)),
  () => Object.defineProperty(new Walker("abc"), "till", { get() { return "got"; }, set(v) { out.push("set " + v); }, enumerable: true }), () => Object.create(new Walker("below")), () => new Proxy(new Walker("abc"), {}),
  () => new (class Heir extends Walker { constructor() { super("heir", true); this.more = 1; } copy(by) { return "h" + super.copy(by) + this.more; } })(), () => { const s = new Walker("abc"); Object.defineProperty(s, "from", { value: 3, writable: false }); return s; },
];
for (const create of strange) for (let round = 0; round < 3; round++) out.push(show(() => { const s = create(); return s.early + s.run(3) + s.run(2); }));
const kept = new Walker("kept"); for (let i = 0; i < 4; i++) { out.push(show(() => kept.run(1))); if (i === 1) delete kept.wasTill; if (i === 2) kept.wasTill = "back"; }
for (const line of out) console.log(line);
