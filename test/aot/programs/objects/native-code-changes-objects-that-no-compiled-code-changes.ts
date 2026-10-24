// Every field of these objects is filled at the allocation and no compiled statement deletes, redefines or stores another type to it.
// Only built-in functions do, each on an object of a class of its own.
function show(label: string, ...values: unknown[]) {
  console.log(label + ": " + values.map(value => (typeof value === "function" ? "function" : JSON.stringify(value) ?? String(value))).join(" | "));
}
function attempt(run: () => unknown): unknown {
  try {
    return run();
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}

class ByReflectSet { count: number = 1; ratio: number = 0.5; on: boolean = true; }
class ByProxy { count: number = 1; ratio: number = 0.5; on: boolean = true; }
class ByAssign { count: number = 1; ratio: number = 0.5; on: boolean = true; }
class ByDelete { count: number = 1; ratio: number = 0.5; on: boolean = true; }
class ByDefine { count: number = 1; ratio: number = 0.5; on: boolean = true; }
class ByPush { count: number = 1; ratio: number = 0.5; on: boolean = true; }
class ByCapture { count: number = 1; ratio: number = 0.5; on: boolean = true; }
class ByDefineGetter { count: number = 1; ratio: number = 0.5; on: boolean = true; }
class ByEntries { count: number = 1; ratio: number = 0.5; on: boolean = true; }

function sum(object: { count: number; ratio: number; on: boolean }): number {
  let total = 0;
  for (let i = 0; i < 3; i++) total += object.count + object.ratio + (object.on ? 1 : 0);
  return total;
}
function describe(object: { count: number; ratio: number; on: boolean }): string {
  return Object.keys(object).join(",") + " ; " + String(object.count) + " " + String(object.ratio) + " " + String(object.on) + " ; " + String(sum(object));
}

{
  const object = new ByReflectSet();
  show("Reflect.set before", describe(object));
  show("Reflect.set", Reflect.set(object, "count", "text"), Reflect.set(object, "ratio", null), Reflect.set(object, "on", undefined));
  show("Reflect.set after", describe(object));
}
{
  const object = new ByProxy();
  const proxy = new Proxy(object, {}) as any;
  proxy.count = "text";
  proxy.ratio = { valueOf() { return 2; } };
  proxy.on = 0;
  proxy.added = 1;
  delete proxy.on;
  show("Proxy", describe(object), (object as any).added);
}
{
  const object = new ByAssign();
  Object.assign(object, JSON.parse('{"count":"text","ratio":null,"on":7,"added":[1]}'));
  show("Object.assign", describe(object), (object as any).added);
}
{
  const object = new ByDelete();
  show("Reflect.deleteProperty", Reflect.deleteProperty(object, "count"), Reflect.deleteProperty(object, "on"), describe(object), "count" in object, Object.hasOwn(object, "on"));
}
{
  const object = new ByDefine();
  Object.defineProperty(object, "count", { get() { return 41; }, enumerable: false, configurable: true });
  Object.defineProperty(object, "ratio", { value: 3, writable: false });
  Object.defineProperties(object, { on: { value: "yes" }, 0: { get() { return "index"; }, configurable: true } });
  show("Object.defineProperty", describe(object), attempt(() => { "use strict"; object.ratio = 4; return object.ratio; }), (object as any)[0]);
}
{
  const object = new ByPush();
  show("Array.prototype.push", Array.prototype.push.call(object, "first", "second"), describe(object), (object as any)[1], (object as any).length);
}
{
  const object = new ByCapture();
  Error.captureStackTrace(object);
  show("Error.captureStackTrace", typeof (object as any).stack, Object.keys(object).join(","), Object.getOwnPropertyNames(object).includes("stack"), sum(object));
}
{
  const object = new ByDefineGetter() as any;
  object.__defineGetter__("count", () => 5);
  object.__defineSetter__("on", function (this: any, value: unknown) { this.seen = value; });
  object.on = "stored";
  show("__defineGetter__", describe(object), object.seen);
}
{
  const object = new ByEntries();
  for (const [key, value] of Object.entries({ count: -0, ratio: NaN, on: null })) Reflect.set(object, key, value);
  show("numbers", Object.is(object.count, -0), object.ratio, object.on, describe(object));
  for (const value of [2 ** 31, -(2 ** 31), -(2 ** 31) + 1, -(2 ** 31) + 4, -(2 ** 31) + 5, 2 ** 31 - 1, 0.5, Infinity]) {
    Reflect.set(object, "count", value);
    show("count", object.count, object.count + 1);
  }
}
