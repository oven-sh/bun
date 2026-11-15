// Evaluated text is interpreted in an executable: constructors that are made again and again by the same text, each with a prototype of its own, whose instances meet at one site, so that their
// Structures no longer say what their prototype is: by new, by super, by Reflect.construct() with another new.target, after prototypes change, on the main thread and in a worker.
const text = `(function () {
  const lines = [];
  const makers = [
    i => { function Made(x) { this.x = x; this.i = i; } Made.prototype.m = function () { return "m" + i + this.x; }; Made.prototype.only = i; return Made; },
    i => class { constructor(x) { this.x = x; } m() { return "c" + i + this.x; } get only() { return i; } },
    i => class { x = i; y = 2; m() { return "f" + i + this.x; } static only = i; },
    i => { function Definition(def) { const inst = def && def.inst ? def.inst : this; init(inst, def, i); for (const key in Definition.prototype) if (!(key in inst)) inst[key] = i; return inst; } Object.defineProperty(Definition, "name", { value: "D" + i }); Definition.prototype.m = function () { return "d" + this._zod.def + this._zod.i; }; return Definition; },
    i => { const Made = function () { if (!new.target) return "called"; this.a = 1; if (i & 1) this.b = 2; }; Made.prototype = { m() { return "o" + i; }, only: i }; return Made; },
    i => class extends (class { constructor(x) { this.x = x; } base() { return "base" + i; } }) { m() { return "h" + i + this.base(); } },
  ];
  function init(inst, def, i) { if (!inst._zod) Object.defineProperty(inst, "_zod", { value: { def, i, traits: [] }, enumerable: false }); inst._zod.traits.push(i); return inst._zod.def; }
  const read = o => o.x, absent = o => o.absent, call = o => { try { return o.m(); } catch (error) { return error.name; } }, inherited = o => o.only, store = (o, v) => { o.x = v; return o.x; }, zod = o => o._zod === undefined ? "none" : o._zod.i;
  const kept = [];
  for (let i = 0; i < 60; i++) {
    for (let k = 0; k < makers.length; k++) {
      const Made = makers[k](i), objects = [new Made(i), new Made("s"), Reflect.construct(Made, [i]), Reflect.construct(Made, [1], makers[(k + 1) % makers.length](i)), new (Made.bind(null, i))(), new (class extends Made {})(i)];
      kept.push(Made, ...objects);
      for (const o of objects) lines.push([read(o), absent(o), o.m ? call(o) : "-", inherited(o), store(o, i), zod(o), Object.keys(o).join("|"), Object.getPrototypeOf(o) === Made.prototype, o instanceof Made, o.constructor === Made].join());
      if (i % 9 === 4) { Made.prototype.late = "late" + i; lines.push(objects.map(o => o.late).join()); }
      if (i % 13 === 5 && typeof Made.prototype.m === "function" && Object.getOwnPropertyDescriptor(Made, "prototype").writable) { Made.prototype = { m() { return "new " + i; } }; const o = new Made(3); lines.push([call(o), read(o), absent(o), Object.getPrototypeOf(o) === Made.prototype].join()); }
    }
    if (i === 20 || i === 40) collect();
  }
  for (let k = 1; k < kept.length; k += 7) { const o = kept[k]; lines.push(typeof o === "function" ? "F" : [read(o), absent(o), inherited(o), zod(o), o.m ? call(o) : "-", o.late].join()); }
  return lines.join("\\n");
})()`;
globalThis.collect = () => Bun.gc(true);
const { Worker, isMainThread, parentPort } = require("node:worker_threads");
const answer = (0, eval)(text);
console.log(answer);
console.log((0, eval)(text) === answer);
const worker = new Worker(`globalThis.collect = () => Bun.gc(true); const { parentPort } = require("node:worker_threads"); parentPort.postMessage([(0, eval)(${JSON.stringify(text)}), (0, eval)(${JSON.stringify(text)})]);`, { eval: true });
worker.on("message", answers => {
  console.log(answers.map(one => one === answer).join());
  worker.terminate();
});
worker.on("error", error => console.log("error", error.message));
