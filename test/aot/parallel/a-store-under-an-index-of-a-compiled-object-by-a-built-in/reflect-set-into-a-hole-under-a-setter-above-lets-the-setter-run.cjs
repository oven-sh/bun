const turns = Number(process.argv[2] ?? 3);
for (let turn = 0; turn < turns; turn++) {
  const heard = [];
  const above = {};
  Object.defineProperty(above, "1", { configurable: true, set(value) { heard.push(value); } });
  const bag = { length: 0 };
  Object.setPrototypeOf(bag, above);
  Array.prototype.push.call(bag, "first");
  const intoAHole = Reflect.set(bag, 1, "second");
  const overTheFirst = Reflect.set(bag, 0, "again");
  console.log("SAID", turn, intoAHole, overTheFirst, heard.join(), JSON.stringify(bag), Object.keys(bag).join());
}
