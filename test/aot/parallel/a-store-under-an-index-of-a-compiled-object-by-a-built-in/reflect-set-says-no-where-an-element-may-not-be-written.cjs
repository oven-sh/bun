const turns = Number(process.argv[2] ?? 3);
const make = () => { const bag = { length: 0 }; for (const item of JSON.parse("[1,2]")) Array.prototype.push.call(bag, item); return bag; };
for (let turn = 0; turn < turns; turn++) {
  const said = [];
  for (const close of [Object.freeze, Object.seal, Object.preventExtensions]) {
    const bag = close(make());
    said.push(close.name, Reflect.set(bag, 0, "over"), Reflect.set(bag, 2, "new"), JSON.stringify(bag));
  }
  const fixed = make();
  Object.defineProperty(fixed, "0", { writable: false });
  const heard = [];
  Object.defineProperty(fixed, "1", { set(value) { heard.push(value); } });
  said.push("fixed", Reflect.set(fixed, 0, "over"), Reflect.set(fixed, 1, "to the setter"), heard.join(), fixed[0]);
  console.log("SAID", turn, said.join(" "));
}
