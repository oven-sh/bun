// Symbols stand between names as accessors, methods and definitions with attributes, in frozen and sealed objects too; each object and its copies are printed.
function pick(name: string): any {
  return (Symbol as any)[name];
}
function show(label: string, made: any) {
  console.log(label, made);
  console.log(label, "own keys", Reflect.ownKeys(made));
  console.log(label, "assigned", Object.assign({}, made));
  console.log(label, "spread", { ...made });
}
const first = pick("asyncDispose");
const second = pick("iterator");
show("getter under a symbol", {
  get [first]() {
    return 1;
  },
  size: 2,
});
show("setter under a symbol", { set [first](value: number) {}, size: 2 });
show("both under a symbol", {
  get [first]() {
    return 1;
  },
  set [first](value: number) {},
  size: 2,
});
show("symbol, getter, name", {
  [first]: 1,
  get size() {
    return 2;
  },
  count: 3,
});
show("symbol, name, getter", {
  [first]: 1,
  size: 2,
  get count() {
    return 3;
  },
});
show("async method", { async [first]() {}, size: 2 });
show("generator method", { *[first]() {}, size: 2 });
show("method, symbol, method", { run() {}, [first]: 1, stop() {} });
const defined: any = { size: 1 };
Object.defineProperty(defined, first, { value: 2, enumerable: true, writable: true, configurable: true });
defined.count = 3;
show("defined between", defined);
const hidden: any = { size: 1 };
Object.defineProperty(hidden, first, { value: 2, enumerable: false, writable: true, configurable: true });
hidden.count = 3;
show("hidden between", hidden);
const fixed: any = { size: 1 };
Object.defineProperty(fixed, first, { value: 2, enumerable: true });
fixed.count = 3;
show("read-only between", fixed);
show("frozen", Object.freeze({ [first]: 1, size: 2, [second]: 3, count: 4 }));
show("sealed", Object.seal({ [first]: 1, size: 2 }));
