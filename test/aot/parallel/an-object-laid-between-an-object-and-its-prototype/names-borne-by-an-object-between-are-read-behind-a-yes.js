// Behind a yes the object's shape is known. A plain object between it and its class's prototype bears a name that no class has, gets one later, and later hides a method.
// STATISTIC: InstanceOfTestsJumpThreaded >= 1
class F { constructor(n) { this.n = n; } f() { return 1; } get g() { return 2; } }
class Sub extends F { s() { return 3; } }
class Other { constructor(n) { this.n = n; } }
const named = text => JSON.parse('"' + text + '"');
const lay = Object[named("setPrototypeOf")], create = Object[named("create")], define = Object[named("defineProperty")];
const bearing = create(F.prototype);
bearing[named("extra")] = 5;
const empty = create(F.prototype);
const things = [new F(1), new Sub(2), new Other(3), new F(4), new F(5), new Sub(6), new F(7)];
lay(things[3], bearing);
lay(things[4], empty);
function ask() {
  const said = [];
  for (let i = 0; i < things.length; i++) {
    const thing = things[i];
    if (thing instanceof F) said.push(thing.f(), thing.g, thing.extra === undefined ? 0 : thing.extra, "extra" in thing ? 1 : 0, thing.n);
    else said.push(-1);
  }
  return said.join("");
}
const all = [];
for (let turn = 0; turn < 360; turn++) {
  if (turn === 60) empty[named("extra")] = 7;
  if (turn === 120) empty[named("f")] = () => 9;
  if (turn === 180) define(empty, "g", { get() { return 8; } });
  if (turn === 240) lay(things[6], bearing);
  if (turn === 300) define(bearing, "n", { value: 6 });
  const answer = ask();
  if (all[all.length - 1] !== answer) all.push(turn, answer);
}
console.log(all.join("\n"));
