let calls = 0, reads = 0;
function tick() { calls++; }
class Rows extends Array {}
Object.defineProperty(Rows.prototype, 1, { get() { reads++; return 9; } });
function ofHoles() { tick.apply(null, new Rows(3)); }
function ofLiteral() {
  const list = Rows.of(1, 2, 3);
  delete list[1];
  Reflect.apply(tick, null, list);
}
for (let i = 0; i < 300; i++) ofHoles();
console.log(calls, reads);
for (let i = 0; i < 300; i++) ofLiteral();
console.log(calls, reads);
