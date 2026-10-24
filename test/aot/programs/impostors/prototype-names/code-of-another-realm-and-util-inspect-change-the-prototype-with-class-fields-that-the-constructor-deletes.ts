// Two library routes. Text run by node:vm in a context of its own gets the prototype as a global and defines accessors on it: functions of another realm.
// util.inspect with `getters: true` runs a lazy getter of the class on the prototype object itself, and the getter's typed store lands there.
// In this twin the optional fields are class fields without `declare`: they are defined at birth and the constructor deletes them, so the slots are declared and empty. Every instance may reach unknown code.
import { inspect } from "node:util";
import vm from "node:vm";
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
class Foreign {
  declare id: number;
  level?: number;
  constructor(id: number) {
    delete this.level;
    handOver(this);
    this.id = id;
  }
}
let computed = 0;
class Inspected {
  declare id: number;
  cache?: number;
  constructor(id: number) {
    delete this.cache;
    handOver(this);
    this.id = id;
  }
  get lazy() {
    return (this.cache ??= ++computed * 10);
  }
}
function levelOf(object: Foreign) {
  return object.level;
}
function setLevel(object: Foreign, value: number) {
  object.level = value;
}
function cacheOf(object: Inspected) {
  return object.cache;
}

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const foreign = new Foreign(i);
  const inspected = new Inspected(i);
  sum += (levelOf(foreign) ?? 1) + (cacheOf(inspected) ?? 1);
  if (i & 1) setLevel(foreign, 2);
  sum += levelOf(foreign) ?? 1;
}
console.log("warm", sum);

const foreign = new Foreign(1);
const seen: string[] = [];
vm.runInNewContext("Object.defineProperty(holder, name, { get() { return this.id + 70 }, set(value) { seen.push('level = ' + value + ' on ' + this.id) }, configurable: true })", {
  holder: Foreign.prototype,
  name: "level",
  seen,
});
console.log("another realm:", levelOf(foreign), levelOf(new Foreign(2)), "level" in foreign, Object.keys(foreign).join());
setLevel(foreign, 5);
setLevel(new Foreign(3), 6);
console.log("stores:", levelOf(foreign), Object.keys(foreign).join(), seen.join(", "));
vm.runInNewContext("delete holder.level", { holder: Foreign.prototype });
setLevel(foreign, 7);
console.log("gone again:", levelOf(foreign), levelOf(new Foreign(4)), Object.keys(foreign).join(), seen.length);

const inspected = new Inspected(1);
console.log("before:", cacheOf(inspected), Object.hasOwn(Inspected.prototype, "cache"));
const text = inspect(Inspected.prototype, { getters: true });
console.log("inspected:", text.includes("lazy"), computed, Object.hasOwn(Inspected.prototype, "cache"));
console.log("after:", cacheOf(inspected), inspected.lazy, Object.keys(inspected).join(), cacheOf(new Inspected(2)), computed);
