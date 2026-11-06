// Literals hold symbols that the build does not know under computed keys, in front of, between and behind names; console.log and Bun.inspect list the keys of each, and of its copies, in the order of their creation.
function pick(name: string): any {
  return (Symbol as any)[name];
}
function show(label: string, made: any) {
  console.log(label, made);
  console.log(label, "own keys", Reflect.ownKeys(made));
  console.log(label, "assigned", Object.assign({}, made));
  console.log(label, "spread", { ...made });
  console.log(label, "inspected", Bun.inspect(made));
}
const first = pick("asyncDispose");
const second = pick("iterator");
const fresh = () => Symbol("fresh");

show("symbol, name", { [first]: 1, size: 2 });
show("name, symbol, name", { size: 1, [first]: 2, count: 3 });
show("symbol, symbol, name", { [first]: 1, [second]: 2, size: 3 });
show("symbol, name, symbol, name", { [first]: 1, size: 2, [second]: 3, count: 4 });
show("name, name, symbol", { size: 1, count: 2, [first]: 3 });
show("fresh symbol, name", { [fresh()]: 1, size: 2 });
show("method under a symbol", { [first]() {}, size: 2 });
show("text, name", { [String(first.description)]: 1, size: 2 });
show("text, symbol, name", { [String(first.description)]: 1, [second]: 2, size: 3 });
show("symbol, text, name", { [second]: 1, [String(first.description)]: 2, size: 3 });
show("number, symbol, name", { [Number("7")]: 1, [first]: 2, size: 3 });
show("symbol, number, name", { [first]: 1, [Number("7")]: 2, size: 3 });
show("symbol, 7, name", { [first]: 1, 7: 2, size: 3 });
show("the same symbol twice", { [first]: 1, size: 2, [first]: 3, count: 4 });
show("a name under a computed key", { [first]: 1, ["si" + "ze"]: 2, size: 3, count: 4 });
