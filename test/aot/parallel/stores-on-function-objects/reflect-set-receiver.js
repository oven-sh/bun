// Reflect.set on a function object with another receiver creates the property on the receiver.
const log = [];
const Kind = { tag: "kind", set watched(value) { log.push("watched " + value + " " + typeof this); } };
for (let round = 0; round < 4; round++) {
  function Made() {}
  function Other() {}
  Object.setPrototypeOf(Made, Kind);
  Made.own = 1;
  const record = { kept: true };
  const frozen = Object.freeze({});
  log.push(Reflect.set(Made, "fresh", round, record), Reflect.set(Made, "own", round, record), Reflect.set(Made, "fresh", round, Other), Reflect.set(Made, "watched", round, Other), Reflect.set(Made, "fresh", round, frozen), Reflect.set(Made, "fresh", round, 5), Reflect.set(record, "viaRecord", round, Made), Reflect.set(Made, "name", "x", Made), Reflect.set(Made, "mine", round));
  log.push(Object.keys(Made).join(), Object.keys(Other).join(), JSON.stringify(record), Made.own);
}
console.log(log.join("\n"));
