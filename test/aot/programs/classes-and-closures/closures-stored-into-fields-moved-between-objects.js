// An arrow function in a field of one object comes into the same field of another object, by every way a program has, each way with a class of its own, so that no way hides behind another.
// The function goes on working on the object that it was made for, also where the call is written `other.field()`. And the field takes what is no function at all.
const lines = [];
function say(...values) {
  lines.push(values.map(String).join(" "));
}
function put(object, key, value) {
  object[key] = value;
}

class Stored {
  name;
  tell = () => "Stored " + this.name;
  constructor(name) {
    this.name = name;
  }
}
function moveStored(to, from) {
  to.tell = from.tell;
}
function tellStored(object) {
  return object.tell();
}
for (const readsFirst of [false, true]) {
  const from = new Stored("from");
  const to = new Stored("to");
  const untouched = new Stored("untouched");
  const before = readsFirst ? [from.tell, to.tell] : null;
  moveStored(to, from);
  say(tellStored(to), "|", tellStored(from), "|", tellStored(untouched), to.tell === from.tell, before ? before[0] === to.tell && before[1]() : "-", Object.keys(to).join());
}

class Computed {
  name;
  tell = () => "Computed " + this.name;
  constructor(name) {
    this.name = name;
  }
}
function moveComputed(to, from) {
  for (const key of ["tell"]) to[key] = from[key];
}
function tellComputed(object) {
  return object.tell();
}
for (const readsFirst of [false, true]) {
  const from = new Computed("from");
  const to = new Computed("to");
  const untouched = new Computed("untouched");
  const before = readsFirst ? [from.tell, to.tell] : null;
  moveComputed(to, from);
  say(tellComputed(to), "|", tellComputed(from), "|", tellComputed(untouched), to.tell === from.tell, before ? before[0] === to.tell && before[1]() : "-", Object.keys(to).join());
}

class ByKeys {
  name;
  tell = () => "ByKeys " + this.name;
  constructor(name) {
    this.name = name;
  }
}
function moveByKeys(to, from) {
  for (const key of Object.keys(from)) if (typeof from[key] === "function") to[key] = from[key];
}
function tellByKeys(object) {
  return object.tell();
}
for (const readsFirst of [false, true]) {
  const from = new ByKeys("from");
  const to = new ByKeys("to");
  const untouched = new ByKeys("untouched");
  const before = readsFirst ? [from.tell, to.tell] : null;
  moveByKeys(to, from);
  say(tellByKeys(to), "|", tellByKeys(from), "|", tellByKeys(untouched), to.tell === from.tell, before ? before[0] === to.tell && before[1]() : "-", Object.keys(to).join());
}

class Assigned {
  name;
  tell = () => "Assigned " + this.name;
  constructor(name) {
    this.name = name;
  }
}
function moveAssigned(to, from) {
  const { name } = to;
  Object.assign(to, from, { name });
}
function tellAssigned(object) {
  return object.tell();
}
for (const readsFirst of [false, true]) {
  const from = new Assigned("from");
  const to = new Assigned("to");
  const untouched = new Assigned("untouched");
  const before = readsFirst ? [from.tell, to.tell] : null;
  moveAssigned(to, from);
  say(tellAssigned(to), "|", tellAssigned(from), "|", tellAssigned(untouched), to.tell === from.tell, before ? before[0] === to.tell && before[1]() : "-", Object.keys(to).join());
}

class AssignedFromSpread {
  name;
  tell = () => "AssignedFromSpread " + this.name;
  constructor(name) {
    this.name = name;
  }
}
function moveAssignedFromSpread(to, from) {
  const { tell } = { ...from };
  Object.assign(to, { tell });
}
function tellAssignedFromSpread(object) {
  return object.tell();
}
for (const readsFirst of [false, true]) {
  const from = new AssignedFromSpread("from");
  const to = new AssignedFromSpread("to");
  const untouched = new AssignedFromSpread("untouched");
  const before = readsFirst ? [from.tell, to.tell] : null;
  moveAssignedFromSpread(to, from);
  say(tellAssignedFromSpread(to), "|", tellAssignedFromSpread(from), "|", tellAssignedFromSpread(untouched), to.tell === from.tell, before ? before[0] === to.tell && before[1]() : "-", Object.keys(to).join());
}

class Reflected {
  name;
  tell = () => "Reflected " + this.name;
  constructor(name) {
    this.name = name;
  }
}
function moveReflected(to, from) {
  Reflect.set(to, "tell", Reflect.get(from, "tell"));
}
function tellReflected(object) {
  return object.tell();
}
for (const readsFirst of [false, true]) {
  const from = new Reflected("from");
  const to = new Reflected("to");
  const untouched = new Reflected("untouched");
  const before = readsFirst ? [from.tell, to.tell] : null;
  moveReflected(to, from);
  say(tellReflected(to), "|", tellReflected(from), "|", tellReflected(untouched), to.tell === from.tell, before ? before[0] === to.tell && before[1]() : "-", Object.keys(to).join());
}

class Defined {
  name;
  tell = () => "Defined " + this.name;
  constructor(name) {
    this.name = name;
  }
}
function moveDefined(to, from) {
  Object.defineProperty(to, "tell", { value: from.tell, writable: true, enumerable: true, configurable: true });
}
function tellDefined(object) {
  return object.tell();
}
for (const readsFirst of [false, true]) {
  const from = new Defined("from");
  const to = new Defined("to");
  const untouched = new Defined("untouched");
  const before = readsFirst ? [from.tell, to.tell] : null;
  moveDefined(to, from);
  say(tellDefined(to), "|", tellDefined(from), "|", tellDefined(untouched), to.tell === from.tell, before ? before[0] === to.tell && before[1]() : "-", Object.keys(to).join());
}

class DefinedByDescriptor {
  name;
  tell = () => "DefinedByDescriptor " + this.name;
  constructor(name) {
    this.name = name;
  }
}
function moveDefinedByDescriptor(to, from) {
  Object.defineProperties(to, { tell: Object.getOwnPropertyDescriptor(from, "tell") });
}
function tellDefinedByDescriptor(object) {
  return object.tell();
}
for (const readsFirst of [false, true]) {
  const from = new DefinedByDescriptor("from");
  const to = new DefinedByDescriptor("to");
  const untouched = new DefinedByDescriptor("untouched");
  const before = readsFirst ? [from.tell, to.tell] : null;
  moveDefinedByDescriptor(to, from);
  say(tellDefinedByDescriptor(to), "|", tellDefinedByDescriptor(from), "|", tellDefinedByDescriptor(untouched), to.tell === from.tell, before ? before[0] === to.tell && before[1]() : "-", Object.keys(to).join());
}

class ByEntries {
  name;
  tell = () => "ByEntries " + this.name;
  constructor(name) {
    this.name = name;
  }
}
function moveByEntries(to, from) {
  for (const [key, value] of Object.entries(from)) if (typeof value === "function") to[key] = value;
}
function tellByEntries(object) {
  return object.tell();
}
for (const readsFirst of [false, true]) {
  const from = new ByEntries("from");
  const to = new ByEntries("to");
  const untouched = new ByEntries("untouched");
  const before = readsFirst ? [from.tell, to.tell] : null;
  moveByEntries(to, from);
  say(tellByEntries(to), "|", tellByEntries(from), "|", tellByEntries(untouched), to.tell === from.tell, before ? before[0] === to.tell && before[1]() : "-", Object.keys(to).join());
}

class DeletedFirst {
  name;
  tell = () => "DeletedFirst " + this.name;
  constructor(name) {
    this.name = name;
  }
}
function moveDeletedFirst(to, from) {
  delete to.tell;
  to.tell = from.tell;
}
function tellDeletedFirst(object) {
  return object.tell();
}
for (const readsFirst of [false, true]) {
  const from = new DeletedFirst("from");
  const to = new DeletedFirst("to");
  const untouched = new DeletedFirst("untouched");
  const before = readsFirst ? [from.tell, to.tell] : null;
  moveDeletedFirst(to, from);
  say(tellDeletedFirst(to), "|", tellDeletedFirst(from), "|", tellDeletedFirst(untouched), to.tell === from.tell, before ? before[0] === to.tell && before[1]() : "-", Object.keys(to).join());
}

class ThroughAVariable {
  name;
  tell = () => "ThroughAVariable " + this.name;
  constructor(name) {
    this.name = name;
  }
}
function moveThroughAVariable(to, from) {
  let kept = null;
  kept = from.tell;
  to.tell = kept;
}
function tellThroughAVariable(object) {
  return object.tell();
}
for (const readsFirst of [false, true]) {
  const from = new ThroughAVariable("from");
  const to = new ThroughAVariable("to");
  const untouched = new ThroughAVariable("untouched");
  const before = readsFirst ? [from.tell, to.tell] : null;
  moveThroughAVariable(to, from);
  say(tellThroughAVariable(to), "|", tellThroughAVariable(from), "|", tellThroughAVariable(untouched), to.tell === from.tell, before ? before[0] === to.tell && before[1]() : "-", Object.keys(to).join());
}

class ThroughAnArray {
  name;
  tell = () => "ThroughAnArray " + this.name;
  constructor(name) {
    this.name = name;
  }
}
function moveThroughAnArray(to, from) {
  const held = [from.tell];
  to.tell = held.pop();
}
function tellThroughAnArray(object) {
  return object.tell();
}
for (const readsFirst of [false, true]) {
  const from = new ThroughAnArray("from");
  const to = new ThroughAnArray("to");
  const untouched = new ThroughAnArray("untouched");
  const before = readsFirst ? [from.tell, to.tell] : null;
  moveThroughAnArray(to, from);
  say(tellThroughAnArray(to), "|", tellThroughAnArray(from), "|", tellThroughAnArray(untouched), to.tell === from.tell, before ? before[0] === to.tell && before[1]() : "-", Object.keys(to).join());
}

class ByDestructuring {
  name;
  tell = () => "ByDestructuring " + this.name;
  constructor(name) {
    this.name = name;
  }
}
function moveByDestructuring(to, from) {
  ({ tell: to.tell } = from);
}
function tellByDestructuring(object) {
  return object.tell();
}
for (const readsFirst of [false, true]) {
  const from = new ByDestructuring("from");
  const to = new ByDestructuring("to");
  const untouched = new ByDestructuring("untouched");
  const before = readsFirst ? [from.tell, to.tell] : null;
  moveByDestructuring(to, from);
  say(tellByDestructuring(to), "|", tellByDestructuring(from), "|", tellByDestructuring(untouched), to.tell === from.tell, before ? before[0] === to.tell && before[1]() : "-", Object.keys(to).join());
}

class ByUntypedHelper {
  name;
  tell = () => "ByUntypedHelper " + this.name;
  constructor(name) {
    this.name = name;
  }
}
function moveByUntypedHelper(to, from) {
  put(to, "tell", from.tell);
}
function tellByUntypedHelper(object) {
  return object.tell();
}
for (const readsFirst of [false, true]) {
  const from = new ByUntypedHelper("from");
  const to = new ByUntypedHelper("to");
  const untouched = new ByUntypedHelper("untouched");
  const before = readsFirst ? [from.tell, to.tell] : null;
  moveByUntypedHelper(to, from);
  say(tellByUntypedHelper(to), "|", tellByUntypedHelper(from), "|", tellByUntypedHelper(untouched), to.tell === from.tell, before ? before[0] === to.tell && before[1]() : "-", Object.keys(to).join());
}

class Account {
  balance;
  owner;
  report = () => this.owner + ":" + this.balance;
  add = amount => {
    this.balance += amount;
    return this;
  };
  constructor(owner, balance) {
    this.owner = owner;
    this.balance = balance;
  }
}
function reportOf(account) {
  return account.report();
}

// Many plain ones around the moved ones, read afterwards.
const accounts = [];
for (let i = 0; i < 30; i++) accounts.push(new Account("a" + i, i));
for (let i = 3; i < 30; i += 7) accounts[i].report = accounts[i - 1].report;
say("many", accounts.map(reportOf).join());

// A subclass-free copy made by a constructor that takes the functions of another instance.
class Borrowing {
  name;
  tell = () => "own " + this.name;
  constructor(name, lender) {
    this.name = name;
    if (lender) this.tell = lender.tell;
  }
}
const lender = new Borrowing("lender");
const borrowers = [new Borrowing("b1", lender), new Borrowing("b2"), new Borrowing("b3", lender)];
say("borrowing", borrowers.map(borrower => borrower.tell()).join(), borrowers[0].tell === lender.tell, borrowers[1].tell !== lender.tell);

// What is no function.
class Handler {
  handle = () => "handled by " + this.id;
  id;
  constructor(id) {
    this.id = id;
  }
  clear() {
    this.handle = undefined;
  }
  forbid() {
    this.handle = null;
  }
  count() {
    this.handle = 7;
  }
  restore() {
    this.handle = () => "restored for " + this.id;
  }
}
function tryHandle(handler) {
  try {
    return handler.handle();
  } catch (error) {
    return error.constructor.name + ":" + String(handler.handle);
  }
}
const handlers = [];
for (let i = 0; i < 12; i++) {
  const handler = new Handler(i);
  if (i % 4 === 1) handler.clear();
  if (i % 4 === 2) handler.forbid();
  if (i % 4 === 3) handler.count();
  handlers.push(handler);
}
say("cleared", handlers.map(tryHandle).join());
say("cleared keys", handlers.slice(0, 4).map(handler => Object.keys(handler).join("+") + JSON.stringify(handler)).join());
for (const handler of handlers) handler.restore();
say("restored", handlers.map(tryHandle).join());
function meddle(object, key, value) {
  object[key] = value;
}
for (const [index, value] of [undefined, null, 0, "text", Symbol.iterator, 10n, {}, [], () => "other"].entries()) meddle(handlers[index], "handle", value);
say("meddled", handlers.map(tryHandle).join());

// What is no function, each way with a class of its own.
function attempt(object) {
  try {
    return object.handle();
  } catch (error) {
    return error.constructor.name + ":" + String(object.handle);
  }
}

class ClearedByStore {
  handle = () => "ClearedByStore " + this.id;
  id;
  constructor(id) {
    this.id = id;
  }
  restore() {
    this.handle = () => "restored " + this.id;
  }
}
function changeClearedByStore(object) {
  object.handle = undefined;
}
{
  const objects = [new ClearedByStore(0), new ClearedByStore(1), new ClearedByStore(2)];
  const first = objects[2].handle;
  changeClearedByStore(objects[1]);
  changeClearedByStore(objects[2]);
  const changed = objects.map(attempt).join();
  const keys = Object.keys(objects[1]).join("+") + JSON.stringify(objects[1]) + ("handle" in objects[1]);
  objects[1].restore();
  say(changed, keys, objects.map(attempt).join(), first(), Object.keys(objects[1]).join("+"));
}

class NulledByStore {
  handle = () => "NulledByStore " + this.id;
  id;
  constructor(id) {
    this.id = id;
  }
  restore() {
    this.handle = () => "restored " + this.id;
  }
}
function changeNulledByStore(object) {
  object.handle = null;
}
{
  const objects = [new NulledByStore(0), new NulledByStore(1), new NulledByStore(2)];
  const first = objects[2].handle;
  changeNulledByStore(objects[1]);
  changeNulledByStore(objects[2]);
  const changed = objects.map(attempt).join();
  const keys = Object.keys(objects[1]).join("+") + JSON.stringify(objects[1]) + ("handle" in objects[1]);
  objects[1].restore();
  say(changed, keys, objects.map(attempt).join(), first(), Object.keys(objects[1]).join("+"));
}

class NumberByStore {
  handle = () => "NumberByStore " + this.id;
  id;
  constructor(id) {
    this.id = id;
  }
  restore() {
    this.handle = () => "restored " + this.id;
  }
}
function changeNumberByStore(object) {
  object.handle = 7;
}
{
  const objects = [new NumberByStore(0), new NumberByStore(1), new NumberByStore(2)];
  const first = objects[2].handle;
  changeNumberByStore(objects[1]);
  changeNumberByStore(objects[2]);
  const changed = objects.map(attempt).join();
  const keys = Object.keys(objects[1]).join("+") + JSON.stringify(objects[1]) + ("handle" in objects[1]);
  objects[1].restore();
  say(changed, keys, objects.map(attempt).join(), first(), Object.keys(objects[1]).join("+"));
}

class ClearedByHelper {
  handle = () => "ClearedByHelper " + this.id;
  id;
  constructor(id) {
    this.id = id;
  }
  restore() {
    this.handle = () => "restored " + this.id;
  }
}
function changeClearedByHelper(object) {
  put(object, "handle", undefined);
}
{
  const objects = [new ClearedByHelper(0), new ClearedByHelper(1), new ClearedByHelper(2)];
  const first = objects[2].handle;
  changeClearedByHelper(objects[1]);
  changeClearedByHelper(objects[2]);
  const changed = objects.map(attempt).join();
  const keys = Object.keys(objects[1]).join("+") + JSON.stringify(objects[1]) + ("handle" in objects[1]);
  objects[1].restore();
  say(changed, keys, objects.map(attempt).join(), first(), Object.keys(objects[1]).join("+"));
}

class NulledByHelper {
  handle = () => "NulledByHelper " + this.id;
  id;
  constructor(id) {
    this.id = id;
  }
  restore() {
    this.handle = () => "restored " + this.id;
  }
}
function changeNulledByHelper(object) {
  put(object, "handle", null);
}
{
  const objects = [new NulledByHelper(0), new NulledByHelper(1), new NulledByHelper(2)];
  const first = objects[2].handle;
  changeNulledByHelper(objects[1]);
  changeNulledByHelper(objects[2]);
  const changed = objects.map(attempt).join();
  const keys = Object.keys(objects[1]).join("+") + JSON.stringify(objects[1]) + ("handle" in objects[1]);
  objects[1].restore();
  say(changed, keys, objects.map(attempt).join(), first(), Object.keys(objects[1]).join("+"));
}

class TextByHelper {
  handle = () => "TextByHelper " + this.id;
  id;
  constructor(id) {
    this.id = id;
  }
  restore() {
    this.handle = () => "restored " + this.id;
  }
}
function changeTextByHelper(object) {
  put(object, "handle", "text");
}
{
  const objects = [new TextByHelper(0), new TextByHelper(1), new TextByHelper(2)];
  const first = objects[2].handle;
  changeTextByHelper(objects[1]);
  changeTextByHelper(objects[2]);
  const changed = objects.map(attempt).join();
  const keys = Object.keys(objects[1]).join("+") + JSON.stringify(objects[1]) + ("handle" in objects[1]);
  objects[1].restore();
  say(changed, keys, objects.map(attempt).join(), first(), Object.keys(objects[1]).join("+"));
}

class ClearedByAssign {
  handle = () => "ClearedByAssign " + this.id;
  id;
  constructor(id) {
    this.id = id;
  }
  restore() {
    this.handle = () => "restored " + this.id;
  }
}
function changeClearedByAssign(object) {
  Object.assign(object, { handle: undefined });
}
{
  const objects = [new ClearedByAssign(0), new ClearedByAssign(1), new ClearedByAssign(2)];
  const first = objects[2].handle;
  changeClearedByAssign(objects[1]);
  changeClearedByAssign(objects[2]);
  const changed = objects.map(attempt).join();
  const keys = Object.keys(objects[1]).join("+") + JSON.stringify(objects[1]) + ("handle" in objects[1]);
  objects[1].restore();
  say(changed, keys, objects.map(attempt).join(), first(), Object.keys(objects[1]).join("+"));
}

class ClearedByDefinition {
  handle = () => "ClearedByDefinition " + this.id;
  id;
  constructor(id) {
    this.id = id;
  }
  restore() {
    this.handle = () => "restored " + this.id;
  }
}
function changeClearedByDefinition(object) {
  Object.defineProperty(object, "handle", { value: undefined });
}
{
  const objects = [new ClearedByDefinition(0), new ClearedByDefinition(1), new ClearedByDefinition(2)];
  const first = objects[2].handle;
  changeClearedByDefinition(objects[1]);
  changeClearedByDefinition(objects[2]);
  const changed = objects.map(attempt).join();
  const keys = Object.keys(objects[1]).join("+") + JSON.stringify(objects[1]) + ("handle" in objects[1]);
  objects[1].restore();
  say(changed, keys, objects.map(attempt).join(), first(), Object.keys(objects[1]).join("+"));
}

class ClearedByReflect {
  handle = () => "ClearedByReflect " + this.id;
  id;
  constructor(id) {
    this.id = id;
  }
  restore() {
    this.handle = () => "restored " + this.id;
  }
}
function changeClearedByReflect(object) {
  Reflect.set(object, "handle", undefined);
}
{
  const objects = [new ClearedByReflect(0), new ClearedByReflect(1), new ClearedByReflect(2)];
  const first = objects[2].handle;
  changeClearedByReflect(objects[1]);
  changeClearedByReflect(objects[2]);
  const changed = objects.map(attempt).join();
  const keys = Object.keys(objects[1]).join("+") + JSON.stringify(objects[1]) + ("handle" in objects[1]);
  objects[1].restore();
  say(changed, keys, objects.map(attempt).join(), first(), Object.keys(objects[1]).join("+"));
}

class ObjectByStore {
  handle = () => "ObjectByStore " + this.id;
  id;
  constructor(id) {
    this.id = id;
  }
  restore() {
    this.handle = () => "restored " + this.id;
  }
}
function changeObjectByStore(object) {
  object.handle = { no: "function" };
}
{
  const objects = [new ObjectByStore(0), new ObjectByStore(1), new ObjectByStore(2)];
  const first = objects[2].handle;
  changeObjectByStore(objects[1]);
  changeObjectByStore(objects[2]);
  const changed = objects.map(attempt).join();
  const keys = Object.keys(objects[1]).join("+") + JSON.stringify(objects[1]) + ("handle" in objects[1]);
  objects[1].restore();
  say(changed, keys, objects.map(attempt).join(), first(), Object.keys(objects[1]).join("+"));
}

// Objects that never leave the function that makes them.
function local(n) {
  const object = {
    n,
    plain: () => 1,
    own: () => object.n * 2,
  };
  object.late = () => object.n + object.own();
  return object.plain() + object.own() + object.late();
}
function localClass(n) {
  const account = new Account("local", n);
  account.add(1).add(2);
  return account.report();
}
function localSwap(n) {
  const a = new Account("a", n);
  const b = new Account("b", n * 10);
  const report = a.report;
  a.report = b.report;
  b.report = report;
  return a.report() + " " + b.report();
}
let sum = 0;
for (let i = 0; i < 50; i++) sum += local(i);
say("local", sum, localClass(4), localSwap(2), localSwap(3));

console.log(lines.join("\n"));
