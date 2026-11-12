const said = [];
for (let turn = 0; turn < 200; turn++) {
  said.length = 0;
  const told = performance.mark("m" + (turn & 1), { detail: { turn: 7 } }).toJSON();
  said.push(Object.getOwnPropertyNames(told).sort().join(), typeof told.detail, told.detail === null ? "null" : JSON.stringify(told.detail), told.name, told.entryType, typeof told.startTime, told.duration);
  const plain = performance.mark("n").toJSON();
  said.push(String(plain.detail), "detail" in plain);
  const measured = performance.measure("x", "n").toJSON();
  said.push(Object.getOwnPropertyNames(measured).sort().join(), String(measured.detail));
}
console.log(said.join("\n"));
