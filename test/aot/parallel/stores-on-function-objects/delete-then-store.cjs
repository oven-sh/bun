// A property of a function object that was deleted is created anew, at the end of the key order.
const log = [];
const Kind = { tag: "kind", alpha: "above" };
for (let round = 0; round < 4; round++) {
  for (const below of [false, true]) {
    function Made() {}
    if (below) Object.setPrototypeOf(Made, Kind);
    Made.alpha = 1; Made.beta = 2; Made.gamma = 3;
    log.push(delete Made.alpha, String(Made.alpha), Object.keys(Made).join());
    Made.alpha = 4;
    log.push(Object.keys(Made).join(), Made.alpha);
    log.push(delete Made.name, delete Made.length, delete Made.prototype, Reflect.ownKeys(Made).join());
    Made.name = "renamed"; Made.length = 9;
    log.push(Reflect.ownKeys(Made).join(), String(Made.name), String(Made.length), JSON.stringify(Object.getOwnPropertyDescriptor(Made, "name")));
  }
}
console.log(log.join("\n"));
