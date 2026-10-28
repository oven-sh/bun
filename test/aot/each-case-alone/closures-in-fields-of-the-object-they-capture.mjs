// What a built-in object in a field holds is alive as long as the object that has the field, also when nothing reads the field. An executable has no field that nothing reads and that holds a closure or a literal of the program, so no case here has one.
async function collect() { for (let i = 0; i < 4; i++) { await new Promise(done => setTimeout(done, 1)); Bun.gc(true); } }
async function t(name, make) { const [holder, ...weak] = make(); await collect(); console.log(name, weak.map(w => w.deref() !== undefined).join(), typeof holder); }
await t("the holder is the target", () => { const app = {}; app.run = () => app; return [app, new WeakRef(app)]; });
await t("a bound function", () => { const extra = { n: 2 }; const app = {}; app.run = function (x) { return [this, x]; }.bind(app, extra); return [app, new WeakRef(extra)]; });
await t("a map between", () => { const extra = { n: 2 }; const app = {}; app.table = new Map([["self", app], ["keep", extra]]); return [app, new WeakRef(extra)]; });
await t("an instance of a class that extends Map between", () => { const extra = { n: 2 }; class Bag extends Map {} const app = {}; app.table = new Bag([["keep", extra]]); return [app, new WeakRef(extra)]; });
await t("an instance of a class that extends Array between", () => { const extra = { n: 2 }; class List extends Array {} const app = {}; app.list = List.of(extra); return [app, new WeakRef(extra)]; });
await t("a promise between", () => { const extra = { n: 2 }; const app = {}; app.pending = Promise.resolve(extra); return [app, new WeakRef(extra)]; });
await t("a generator between", () => { const extra = { n: 2 }; const app = {}; app.rest = (function* (x) { yield 1; yield x; })(extra); app.rest.next(); return [app, new WeakRef(extra)]; });
