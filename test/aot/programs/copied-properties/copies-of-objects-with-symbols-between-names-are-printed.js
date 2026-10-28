// Spreads, rests, Object.assign and Object.fromEntries copy objects that hold symbols between names; what they make is printed.
function pick(name) {
  return Symbol[name];
}
function show(label, made) {
  console.log(label, made);
  console.log(label, "own keys", Reflect.ownKeys(made));
  console.log(label, "assigned", Object.assign({}, made));
  console.log(label, "spread", { ...made });
}
const first = pick("asyncDispose");
const second = pick("iterator");
const other = { [first]: 1, inner: 2 };
const late = { inner: 1 };
late[second] = 2;
late.more = 3;
show("spread, name", { ...other, size: 3 });
show("name, spread, name", { size: 1, ...other, count: 3 });
show("symbol, spread, name", { [second]: 1, ...other, size: 3 });
show("two spreads", { ...other, ...late, size: 3 });
show("spread over", { [first]: 0, inner: 0, ...other, size: 3 });
show("assign to a literal", Object.assign({ size: 1 }, other, { count: 2 }));
show("assign to a literal with a symbol", Object.assign({ [second]: 1, size: 1 }, other, late));
const { inner, ...rest } = { [first]: 1, inner: 2, size: 3, [second]: 4, count: 5 };
show("rest", rest);
show("__proto__ first", { __proto__: { above: 1 }, [first]: 1, size: 2 });
show("__proto__ between", { [first]: 1, __proto__: { above: 1 }, size: 2 });
show("__proto__ null", { __proto__: null, [first]: 1, size: 2 });
show("computed __proto__", { [first]: 1, ["__proto__"]: 2, size: 3 });
show("created", Object.assign(Object.create({ above: 1 }), { [first]: 1, size: 2 }));
show(
  "from entries",
  Object.fromEntries([
    [first, 1],
    ["size", 2],
    [second, 3],
    ["count", 4],
  ]),
);
