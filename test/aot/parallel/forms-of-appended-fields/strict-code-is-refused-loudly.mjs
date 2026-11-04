function attempt(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }
function Made(v) {
  this.held = v;
  Object.defineProperty(this, "fixed", { value: v, enumerable: true });
  Object.defineProperty(this, "loose", { value: v, writable: true });
  Object.defineProperty(this, "only", { get() { return this.held; }, configurable: true });
  Object.defineProperty(this, "taker", { set(x) { this.held = x; } });
}
function storeFixed(m, v) { m.fixed = v; return m.fixed; }
function storeLoose(m, v) { m.loose = v; return m.loose; }
function storeOnly(m, v) { m.only = v; return m.only; }
function storeTaker(m, v) { m.taker = v; return m.held; }
function bumpFixed(m) { m.fixed++; return m.fixed; }
function dropFixed(m) { return delete m.fixed; }
function dropOnly(m) { return delete m.only; }
function storeBelow(m, v) { const below = Object.create(m); below.fixed = v; return below.fixed; }
const said = [];
for (let i = 0; i < 200; i++) {
  const line = [storeFixed, storeLoose, storeOnly, storeTaker, bumpFixed, dropFixed, dropOnly, storeBelow].map(run => attempt(() => run(new Made(i), i + 1000))).join();
  if (i % 66 === 0) said.push(line);
}
console.log(said.join("\n"));
