// Reads of length and name on functions that no code calls, each changed in another way after it was made.
function plain(a: number, b: number, c: number) {}
function redefined(a: number) {}
Object.defineProperty(redefined, "length", { value: 9 });
Object.defineProperty(redefined, "name", { value: "other" });
function deleted(a: number, b: number) {}
delete (deleted as any).length;
delete (deleted as any).name;
function underKey(a: number) {}
const key = ["na", "me"].join("");
delete (underKey as any)[key];
function inherits(a: number) {}
delete (inherits as any).length;
Object.setPrototypeOf(inherits, { length: 7 });
function throughReflect(a: number) {}
Reflect.defineProperty(throughReflect, "length", { value: 5 });
function accessor(a: number) {}
let reads = 0;
Object.defineProperty(accessor, "name", { get: () => "read" + reads++ });
function assigned(a: number) {}
try { (assigned as any).length = 4; } catch {}
function handed(a: number) {}
const change = new Function("f", 'Object.defineProperty(f, "length", { value: 3 }); Object.defineProperty(f, "name", { value: "seen" });');
change(handed);
function globalOne(a: number) {}
(globalThis as any).globalOne = globalOne;
(0, eval)('Object.defineProperty(globalOne, "length", { value: 2 })');
function later(a: number) {}
function changeLater() { Object.defineProperty(later, "length", { value: 6 }); }
function frozen(a: number) {}
Object.freeze(frozen);
class Named { static name2 = 1; constructor(a: number, b: number) {} }
class StaticName { static name() { return "method"; } }
class StaticLength { static length = 40; }
const arrow = (a: number) => a;
const expression = function (a: number, b = 2, ...rest: number[]) {};
const inObject = { method(a: number) {}, ["com" + "puted"]: function () {} };
async function waits(a: number) {}
function* yields(a: number) {}
const bound = plain.bind(null, 1);
let chosen = plain;
if (reads === 0) chosen = redefined;
function show(label: string, f: any) {
  console.log(label, typeof f.name === "function" ? "function" : f.name, f.length);
}
function direct() {
  console.log(plain.length, plain.name, plain.name.length);
  console.log(redefined.length, redefined.name);
  console.log(deleted.length, deleted.name);
  console.log(underKey.length, underKey.name);
  console.log(inherits.length, inherits.name);
  console.log(throughReflect.length);
  console.log(accessor.name, accessor.name);
  console.log(assigned.length);
  console.log(handed.length, handed.name);
  console.log(globalOne.length);
  console.log(later.length);
  changeLater();
  console.log(later.length);
  console.log(frozen.length, frozen.name);
  console.log(Named.length, Named.name);
  console.log(typeof StaticName.name, StaticName.length);
  console.log(StaticLength.length, StaticLength.name);
  console.log(arrow.length, arrow.name, expression.length, expression.name);
  console.log(inObject.method.length, inObject.method.name, (inObject as any).computed.name);
  console.log(waits.length, waits.name, yields.length, yields.name);
  console.log(bound.length, bound.name, chosen.length, chosen.name);
}
direct();
for (const f of [plain, redefined, deleted, Named, StaticName, arrow]) show("list", f);
