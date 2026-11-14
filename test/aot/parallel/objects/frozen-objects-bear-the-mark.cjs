// Code out of sight freezes objects between the stores of one iteration, before their construction ends and behind a deletion. Nobody in sight freezes them.
const unseen = (0, eval)("({ freeze(o) { return Object.freeze(o) }, seal(o) { return Object.seal(o) }, prevent(o) { return Object.preventExtensions(o) }, remove(o, n) { delete o[n] }, write(o, n, v) { o[n] = v }, proto(o) { return Object.setPrototypeOf(o, Object.create(Object.getPrototypeOf(o))) } })");
globalThis.unseen = unseen;
function Cell(hook) {
  this.first = 1;
  this.second = 2;
  this.text = "t";
  this.list = [1, 2, 3];
  this.hook = hook;
  this.last = 0;
}
Cell.prototype.bump = function () {
  this.first = this.first + 1;
  this.text = this.text + "x";
};
Cell.prototype.run = function (turns) {
  for (let turn = 0; turn < turns; turn++) {
    this.second = this.list.length + turn;
    this.text = this.text.length > 6 ? "t" : this.text + turn;
    this.hook(this, turn);
    this.last = this.list[turn % 3];
    this.second = this.second + this.last;
    this.list = turn & 1 ? this.list : this.list.slice();
    this.hook(this, -turn);
    this.bump();
    this.first = this.second;
  }
  return this;
};
class Strict {
  constructor(hook) {
    this.first = 1;
    this.second = 2;
    this.list = [1, 2, 3];
    this.hook = hook;
  }
  run(turns) {
    for (let turn = 0; turn < turns; turn++) {
      this.second = this.list.length + turn;
      this.hook(this, turn);
      this.first = this.second + this.list[turn % 3];
      this.list = this.list.slice();
    }
    return this;
  }
}
function Early(act) {
  this.first = 1;
  act(this);
  this.second = 2;
  this.third = this.first + 1;
  this.fourth = this.second + this.third;
}
Early.prototype.run = function (turns) {
  for (let turn = 0; turn < turns; turn++) {
    this.first = this.second + turn;
    this.fourth = this.third;
    this.third = this.first;
  }
  return this;
};
globalThis.kept = { Cell, Strict, Early };
const show = o => `${Object.keys(o).map(k => k + "=" + (typeof o[k] === "function" ? "f" : String(o[k]))).join(" ")} ${Object.isFrozen(o)} ${Object.isSealed(o)} ${Object.isExtensible(o)}`;
const tell = (what, f) => {
  let said;
  try { said = show(f()); } catch (e) { said = e.constructor.name; }
  console.log(what, said);
};
tell("quiet", () => new Cell(() => {}).run(9));
tell("strict", () => new Strict(() => {}).run(9));
for (const act of ["freeze", "seal", "prevent", "proto"]) {
  for (const at of [0, 1, 3, -2, -5]) {
    tell(`${act} ${at}`, () => new Cell((o, turn) => { if (turn === at) unseen[act](o); }).run(7));
    tell(`${act} ${at} twice`, () => new Cell((o, turn) => { if (turn === at) unseen[act](o); }).run(7).run(3));
    tell(`strict ${act} ${at}`, () => new Strict((o, turn) => { if (turn === at) unseen[act](o); }).run(7));
  }
  tell(`early ${act}`, () => new Early(o => unseen[act](o)).run(5));
  tell(`before ${act}`, () => unseen[act](new Cell(() => {})).run(5));
  tell(`removed ${act}`, () => new Cell((o, turn) => { if (turn === 2) { unseen.remove(o, "second"); unseen[act](o); } if (turn === 4) unseen.write(o, "second", 5); }).run(8));
  tell(`written ${act}`, () => new Cell((o, turn) => { if (turn === 2) unseen[act](o); unseen.write(o, "last", turn); }).run(8));
}
const frozen = unseen.freeze(new Cell(() => {}));
for (let i = 0; i < 4; i++) { frozen.first = i; frozen.bump(); frozen.last = frozen.first; }
console.log(show(frozen), show(Object.assign(new Cell(() => {}), frozen)), show({ ...frozen }));
console.log(show(Object.assign(Object.create(Cell.prototype), frozen).run(3)), show(Object.create(frozen, {})));
