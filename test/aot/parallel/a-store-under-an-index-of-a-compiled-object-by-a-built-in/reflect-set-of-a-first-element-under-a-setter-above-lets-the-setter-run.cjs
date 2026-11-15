const turns = Number(process.argv[2] ?? 3);
for (let turn = 0; turn < turns; turn++) {
  const heard = [];
  const above = {};
  Object.defineProperty(above, "0", { configurable: true, set(value) { heard.push(value); } });
  const bag = { length: 0 };
  Object.setPrototypeOf(bag, above);
  const first = Reflect.set(bag, 0, "to the setter");
  const beside = Reflect.set(bag, 1, "its own");
  console.log("SAID", turn, first, beside, heard.join(), JSON.stringify(bag), Object.keys(bag).join());
}
