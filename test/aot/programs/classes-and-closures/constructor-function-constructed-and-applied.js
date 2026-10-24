// One call site whose callee is Reflect.construct or Reflect.apply: each function is constructed and also applied to an object that exists.
let count = 0;
function ThirdIsList() { this.x = ++count; }
function ThirdIsFunction() { this.x = ++count; }
function StoresClosure() { this.get = () => this; }
function BySpecies() { this.x = ++count; }

function runList(flags) {
  const object = new ThirdIsList();
  let changes = 0;
  for (const flag of flags) {
    const enter = flag ? Reflect.construct : Reflect.apply;
    const before = object.x;
    try { enter(ThirdIsList, object, []); } catch {}
    if (object.x !== before) changes++;
  }
  return changes;
}
function runFunction(flags) {
  const object = new ThirdIsFunction();
  let changes = 0;
  for (const flag of flags) {
    const enter = flag ? Reflect.construct : Reflect.apply;
    const before = object.x;
    enter(ThirdIsFunction, object, ThirdIsFunction);
    if (object.x !== before) changes++;
  }
  return changes;
}
function runClosure(flags) {
  const object = new StoresClosure();
  let changes = 0;
  for (const flag of flags) {
    const enter = flag ? Reflect.construct : Reflect.apply;
    const before = object.get;
    try { enter(StoresClosure, object, []); } catch {}
    if (object.get !== before) changes++;
    if (object.get() !== object) changes += 100;
  }
  return changes;
}
function runSpecies() {
  const object = new BySpecies();
  const list = [5, 6];
  list.constructor = { [Symbol.species]: BySpecies };
  const before = object.x;
  list.map(BySpecies, object);
  return object.x - before;
}
const flags = [true, false, true, false, false];
console.log(runList(flags), runFunction(flags), runClosure(flags), runSpecies());
