// Object.assign(target, source) of two arguments takes no call of the built-in where it runs no code of the program, and is the same where it does.
// The operation has two names: one for a target that is a literal written in the call, which nobody else has seen, and one for any other.
// COUNT: operation:operationAOTObjectAssignToUnseenObject >= 2000
// COUNT: operation:operationAOTObjectAssignWithoutCode >= 30
type Bag = { a?: number; b?: string; c?: number[]; d?: number };
function plain(i: number): Bag {
  return Object.assign({}, { a: i, b: "t" + i });
}
function emptyOne(i: number): Bag {
  return Object.assign({ a: i }, {});
}
function nothing(i: number, source: null | undefined | number | boolean): Bag {
  return Object.assign({ d: i }, source);
}
let sum = 0;
for (let i = 0; i < 2000; i++) {
  const made = plain(i);
  sum += (made.a ?? 0) + (made.b?.length ?? 0) + (emptyOne(i).a ?? 0) + (nothing(i, i % 2 ? null : undefined).d ?? 0);
}
console.log(sum);
console.log(JSON.stringify(nothing(1, 5)), JSON.stringify(nothing(2, true)));

function assign(target: any, source: any): any {
  return Object.assign(target, source);
}
function attempt(name: string, run: () => unknown) {
  try {
    console.log(name, JSON.stringify(run()));
  } catch (error) {
    console.log(name, "threw", (error as Error).constructor.name, (error as Error).message);
  }
}
const target = {};
console.log("same object", assign(target, { a: 1 }) === target);
attempt("string", () => assign({}, "ab"));
attempt("empty string", () => assign({}, ""));
attempt("symbol", () => assign({}, Symbol("s")));
attempt("list", () => assign({}, [1, , 3]));
attempt("list target", () => assign([9, 9, 9], { 1: "x", length: 2 }));
attempt("function target", () => Object.keys(assign(function () {}, { x: 1 })));
attempt("indexes", () => assign({ z: 1 }, { 2: "two", 1: "one", y: 2 }));
attempt("own __proto__", () => {
  const made = assign({}, JSON.parse('{"__proto__": {"up": 1}, "x": 2}'));
  return [Object.keys(made), made.up, made.x];
});
attempt("getter order", () => {
  const seen: string[] = [];
  const source = {
    get a() { seen.push("a"); return 1; },
    b: 2,
    get c() { seen.push("c"); return 3; },
  };
  return [assign({}, source), seen];
});
attempt("getter that changes the target", () => {
  const into: any = { x: 0 };
  return [assign(into, { get a() { into.x = 9; return 1; }, x: 5 }), into.x];
});
attempt("getter that changes the source", () => {
  const source: any = { get a() { delete source.b; source.c = 3; return 1; }, b: 2 };
  return assign({}, source);
});
attempt("getter that throws", () => assign({ kept: 1 }, { get a(): number { throw new RangeError("from a getter"); } }));
attempt("setter on the target", () => {
  const set: unknown[] = [];
  return [assign({ set a(value: unknown) { set.push(value); } }, { a: 1, b: 2 }), set];
});
attempt("setter below", () => {
  const set: unknown[] = [];
  const into = Object.create({ set a(value: unknown) { set.push(value); } });
  return [assign(into, { a: 1 }), set, Object.keys(into)];
});
attempt("read-only below", () => assign(Object.create(Object.freeze({ a: 1 })), { a: 2 }));
attempt("frozen target", () => assign(Object.freeze({ a: 1 }), { a: 2 }));
attempt("frozen target, empty source", () => assign(Object.freeze({ a: 1 }), {}));
attempt("sealed target, new name", () => assign(Object.seal({ a: 1 }), { b: 2 }));
attempt("not extensible, same name", () => assign(Object.preventExtensions({ a: 1 }), { a: 2 }));
attempt("read-only member", () => assign(Object.defineProperty({}, "a", { value: 1, enumerable: true }), { a: 2 }));
attempt("proxy source", () => {
  const seen: string[] = [];
  const source = new Proxy({ a: 1 }, {
    ownKeys(t) { seen.push("ownKeys"); return Reflect.ownKeys(t); },
    getOwnPropertyDescriptor(t, k) { seen.push("describe " + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); },
    get(t, k, r) { seen.push("get " + String(k)); return Reflect.get(t, k, r); },
  });
  return [assign({}, source), seen];
});
attempt("proxy target", () => {
  const seen: string[] = [];
  const into = new Proxy({}, { set(t, k, v, r) { seen.push("set " + String(k)); return Reflect.set(t, k, v, r); } });
  return [assign(into, { a: 1 }), seen];
});
attempt("hidden and symbols", () => {
  const mark = Symbol("mark");
  const source = Object.defineProperty({ [mark]: 1, a: 2 }, "hidden", { value: 3, enumerable: false });
  const made = assign({}, source);
  return [Object.keys(made), made[mark], made.hidden];
});
attempt("itself", () => {
  const object = { a: 1 };
  return assign(object, object);
});
attempt("instance", () => {
  class Point { x = 1; y = 2; get sum() { return this.x + this.y; } }
  const made = assign({}, new Point());
  return [made, made.sum];
});
attempt("onto an instance", () => {
  class Point { x = 1; set z(value: number) { this.x = value; } }
  return assign(new Point(), { x: 5, z: 7, w: 8 });
});
attempt("a large object", () => {
  const source: Record<string, number> = {};
  for (let i = 0; i < 300; i++) source["id" + i] = i;
  return Object.keys(assign({ first: 0 }, source)).length;
});
attempt("elements", () => assign({ a: 1 }, Object.assign({ 5000: 1 }, { 7000: 2 })));
attempt("null target", () => (Object.assign as any)(null, {}));
attempt("number target", () => assign(5, { a: 1 }));
// A source without properties has a plan without stores, the second time as the first.
const nothingParsed = JSON.parse("{}");
for (let round = 0; round < 4; round++) {
  attempt("nothing parsed", () => assign({}, nothingParsed));
  attempt("nothing parsed onto a member", () => assign({ kept: round }, nothingParsed));
  attempt("no prototype and nothing", () => assign({}, Object.create(null)));
  attempt("nothing made by a constructor", () => assign({}, new (function (this: any) {} as any)()));
}
for (const names of [1, 2, 3, 6, 7, 12]) {
  const parsed = JSON.parse("{" + Array.from({ length: names }, (_, i) => `"n${i}":${i}`).join() + "}");
  for (let round = 0; round < 3; round++) attempt("parsed " + names, () => assign({}, parsed));
}
