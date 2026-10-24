// One call site whose callee is Reflect.construct or Reflect.apply, with the same kind of list for both.
let count = 0;
function ConstructFirst() { this.x = ++count; }
function ApplyFirst() { this.x = ++count; }
function StoresClosure() { this.get = () => this; }

function runConstructFirst(flags) {
  const object = new ConstructFirst();
  let changes = 0;
  for (const flag of flags) {
    const enter = flag ? Reflect.construct : Reflect.apply;
    const before = object.x;
    try { enter(ConstructFirst, object, object); } catch {}
    if (object.x !== before) changes++;
  }
  return changes;
}
function runApplyFirst(flags) {
  const object = new ApplyFirst();
  let changes = 0;
  for (const flag of flags) {
    const enter = flag ? Reflect.apply : Reflect.construct;
    const before = object.x;
    try { enter(ApplyFirst, object, object); } catch {}
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
    try { enter(StoresClosure, object, object); } catch {}
    if (object.get !== before) changes++;
    if (object.get() !== object) changes += 100;
  }
  return changes;
}
const flags = [true, false, true, false, false];
console.log(runConstructFirst(flags), runApplyFirst(flags), runClosure(flags));
