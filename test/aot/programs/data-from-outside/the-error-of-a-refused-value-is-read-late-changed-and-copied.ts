// The message and the issues of the error say what the value was when it was refused, however late and in whatever way they are read.
import type { Schema } from "bun";
import { validate } from "bun:bundle";

type Line = { sku: string & Schema.MinLength<1>; quantity: number & Schema.Int & Schema.Min<1> };
type Order = { id: number; lines: Line[]; note?: string & Schema.MaxLength<4> } & Schema.DeepStrict;

function createOrder(): any {
  return { id: 7, lines: [{ sku: "a", quantity: 1 }, { sku: "", quantity: 0 }], note: "too long" };
}

function refuse(value: unknown): any {
  try {
    validate<Order>(value);
  } catch (error) {
    return error;
  }
  return undefined;
}

function refuseText(text: string): any {
  try {
    JSON.parse<Order>(text);
  } catch (error) {
    return error;
  }
  return undefined;
}

// A getter is code of the program: it runs once, while the value is validated.
function createOrderWithGetter(log: string[]): any {
  const order = createOrder();
  Object.defineProperty(order, "id", {
    get() {
      log.push("id is read");
      return 7;
    },
    enumerable: true,
    configurable: true,
  });
  return order;
}

function show(title: string, value: unknown): void {
  console.log(title + ": " + (typeof value === "string" ? value : JSON.stringify(value)));
}

const makers: [string, () => any][] = [
  ["validate", () => refuse(createOrder())],
  ["parse", () => refuseText(JSON.stringify(createOrder()))],
  ["validate, getter", () => refuse(createOrderWithGetter([]))],
];

for (const [name, make] of makers) {
  console.log("== " + name);
  show("message first", make().message);
  show("issues first", make().issues);
  let error = make();
  show("both", [error.issues.length, error.message, error.issues === error.issues]);
  show("is a TypeError", [error instanceof TypeError, Object.getPrototypeOf(error) === TypeError.prototype, error.name]);
  show("toString", String(make()));
  show("first line of the stack", String(make().stack).split("\n")[0]);
  show("stringify", JSON.stringify(make()));
  show("keys", Object.keys(make()));
  show("own names", Reflect.ownKeys(make()).filter(key => key === "message" || key === "issues"));
  show("symbols", Object.getOwnPropertySymbols(make()).length);
  show("in", ["message" in make(), "issues" in make(), Object.hasOwn(make(), "issues"), Object.hasOwn(make(), "message")]);
  show("descriptor of message", Object.getOwnPropertyDescriptor(make(), "message"));
  const descriptor = Object.getOwnPropertyDescriptor(make(), "issues")!;
  show("descriptor of issues", [descriptor.value.length, descriptor.writable, descriptor.enumerable, descriptor.configurable, "get" in descriptor]);
  show("spread", Object.keys({ ...make() }));
  show("spread issues", ({ ...make() } as any).issues.length);
  show("assign", (Object.assign({}, make()) as any).issues[0].path);
  show("entries", Object.entries(make()).map(([key, value]) => [key, (value as any[]).length]));
  const names: string[] = [];
  for (const key in make()) names.push(key);
  show("for in", names);

  error = make();
  error.message = "mine";
  show("a written message stays", [error.message, error.issues.length, error.message]);
  error = make();
  error.issues = "mine";
  show("written issues stay", [error.issues, error.message, error.issues]);
  error = make();
  show("deleted", [delete error.message, error.message, "message" in error, Object.hasOwn(error, "message"), error.issues.length, error.message]);
  error = make();
  show("deleted issues", [delete error.issues, error.issues, error.message, error.issues]);
  error = make();
  Object.defineProperty(error, "message", { value: "defined" });
  show("defined", [error.message, Object.getOwnPropertyDescriptor(error, "message"), error.issues.length]);
  error = make();
  Object.freeze(error);
  show("frozen", [error.message, error.issues.length, Object.isFrozen(error)]);
  error = make();
  const heir = Object.create(error);
  show("inherited", [heir.message, heir.issues.length, Object.hasOwn(heir, "message")]);
  show("cloned", structuredClone(make()).message);
  show("inspected", Bun.inspect(make()).includes("lines[1].sku"));
}

console.log("== what is changed after the refusal is not reported");
const changed = createOrder();
const late = refuse(changed);
changed.id = "no number";
changed.lines[1].quantity = 5;
changed.lines[0].sku = 1;
changed.lines.push(1);
delete changed.note;
changed.more = true;
show("message", late.message);
show("issues", late.issues);

console.log("== code of the program runs while the value is validated, and never later");
const log: string[] = [];
const withGetter = refuse(createOrderWithGetter(log));
show("before the error is read", log);
show("message", withGetter.message);
show("after", log);

console.log("== many errors, each read in a loop");
let characters = 0;
let count = 0;
for (let i = 0; i < 2000; i++) {
  const order = createOrder();
  order.lines[1].quantity = -i;
  const error = i % 2 ? refuse(order) : refuseText(JSON.stringify(order));
  if (i % 3 === 0) continue;
  characters += error.message.length;
  count += error.issues.length;
}
show("sums", [characters, count]);

console.log("== values that are not copied");
const cyclic: any = createOrder();
cyclic.lines[1].sku = cyclic;
show("a cycle", refuse(cyclic).message);
show("a function", refuse({ id: 1, lines: () => 1 }).message);
show("a date", refuse({ id: new Date(0), lines: [] }).message);
show("a hole", refuse({ id: 1, lines: [, { sku: "a", quantity: 1 }] }).message);
show("a proxy", refuse(new Proxy(createOrder(), {})).message);
show("a class", refuse(new (class { id = "x"; lines = []; })()).message);
show("no object", [refuse(1).message, refuse(null).message, refuse(undefined).message, refuse("text").message]);
let deep: any = 0;
for (let i = 0; i < 100; i++) deep = [deep];
show("deep", refuse({ id: 1, lines: deep }).message);
show("wide", refuse({ id: 1, lines: Array.from({ length: 3000 }, () => ({ sku: "a", quantity: 0 })) }).issues.length);
