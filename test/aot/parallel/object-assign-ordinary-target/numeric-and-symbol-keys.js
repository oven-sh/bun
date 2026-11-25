// Index keys come first, then strings in creation order, then symbols.
const mark = Symbol("mark");
const other = Symbol("other");
const proto = { kind: "p" };
function show(made) {
  return Reflect.ownKeys(made).map(String).join() + " " + JSON.stringify(made) + " " + String(made[mark]);
}
for (let round = 0; round < 5; round++) {
  console.log(show(Object.assign(Object.create(proto), { beta: 1, [mark]: 2, alpha: 3 })));
  console.log(show(Object.assign(Object.create(proto), { beta: 1, 2: "two", alpha: 3, 0: "zero" })));
  console.log(show(Object.assign(Object.create(proto), { [other]: 0, [mark]: 2 })));
  console.log(show(Object.assign(Object.create(proto), { "-1": "a", "1.5": "b", "4294967295": "c", 7: "d" })));
  console.log(show(Object.assign(Object.create(proto), [1, 2, 3])));
  console.log(show(Object.assign(Object.create(proto), "text")));
}
