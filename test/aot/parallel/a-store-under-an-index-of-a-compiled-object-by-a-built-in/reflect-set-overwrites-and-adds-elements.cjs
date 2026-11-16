const turns = Number(process.argv[2] ?? 3);
for (let turn = 0; turn < turns; turn++) {
  const bag = { length: 0 };
  for (const item of JSON.parse("[1,2,3,4]")) Array.prototype.push.call(bag, item);
  const said = [];
  for (const [at, value] of JSON.parse('[[0,9],[1,2.5],[2,"text"],[3,null],[4,"added"],[9,"far"],["7","by a text"]]')) said.push(Reflect.set(bag, at, value));
  console.log("SAID", turn, said.join(), JSON.stringify(bag), Object.keys(bag).join(), bag.length);
}
