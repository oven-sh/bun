const turns = Number(process.argv[2] ?? 3);
for (let turn = 0; turn < turns; turn++) {
  const bag = { length: 0 };
  for (const item of JSON.parse("[1,2]")) Array.prototype.push.call(bag, item);
  const other = { length: 0 };
  Array.prototype.push.call(other, "its own");
  const said = [Reflect.set(bag, 0, "for the other", other), Reflect.set(bag, 5, "added to the other", other), Reflect.set(bag, 1, "no object", 7)];
  console.log("SAID", turn, said.join(), JSON.stringify(bag), JSON.stringify(other));
}
