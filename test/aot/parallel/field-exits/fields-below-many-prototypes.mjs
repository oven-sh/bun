// Objects of one function below many prototypes get the same fields: each prototype's objects remember what creates them, until an accessor appears above.
function makePrototype(kind) { return Object.assign(Object.create({ above: kind }), { kind, run() { return this.args + ":" + kind; } }); }
const prototypes = [];
for (let i = 0; i < 40; i++) prototypes.push(makePrototype("k" + i));
const log = [];
const create = prototype => function (first, second) { const self = Object.create(prototype); self.args = first; self.more = second; return self; };
const makers = prototypes.map(create);
const show = o => Object.keys(o).join() + " " + o.args + " " + o.more + " " + o.kind + " " + o.run();
const attempt = f => { try { return f(); } catch (error) { return error.constructor.name; } };
for (let turn = 0; turn < 6; turn++) {
  let text = "";
  for (let n = 0; n < 3; n++) for (let i = 0; i < makers.length; i++) text += attempt(() => { const made = makers[i](n, i); if (i % 7 === n) made.later = i; if (i % 11 === 3) delete made.args; return show(made) + (made.later ?? ""); }) + ";";
  console.log(turn, text, log.join());
  log.length = 0;
  if (turn === 1) for (const i of [3, 9, 20]) Object.defineProperty(prototypes[i], "more", { set(v) { log.push("set " + i + " " + v); }, get() { return "got"; }, configurable: true });
  if (turn === 2) Object.defineProperty(Object.getPrototypeOf(prototypes[5]), "args", { value: "fixed", writable: false, configurable: true });
  if (turn === 3) { for (const i of [3, 9, 20]) delete prototypes[i].more; delete Object.getPrototypeOf(prototypes[5]).args; }
  if (turn === 4) { Object.setPrototypeOf(prototypes[1], { set args(v) { log.push("other " + v); } }); Object.freeze(prototypes[2]); }
}
