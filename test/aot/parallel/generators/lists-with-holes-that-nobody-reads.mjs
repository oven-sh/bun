// STATISTIC: GeneratorFramesBuilt >= 12
// A generator that goes on behind a hidden override makes lists with holes that nobody reads.
const pick = name => (process.argv.length < 0 ? "" : name);
const engines = Object.getPrototypeOf(Object.getPrototypeOf((function* () {})()));
function override() {
  for (let i = 0; i < 5; i++) {
    const { value, done } = engines.next.call(this, i);
    console.log(done ? "done" : "yields", JSON.stringify(value));
  }
  return {};
}

function* records(limit) {
  const record = { list: [1] };
  yield 0;
  [, record.list, , record];
  yield limit;
  [record.list, , record, ,];
  yield record.list.length;
}
console.log([() => records(2)].map(make => make().next().value));
const ofRecords = { get value() { records.prototype[pick("return")] = override; return 1; } };
function walkRecords() {
  for (const value of records(4)) if (ofRecords.value) return value;
}
for (let turn = 0; turn < 2; turn++) console.log(walkRecords());

function* spreads(limit) {
  const record = { list: [1, 2] };
  yield 0;
  [, ...record.list, limit];
  [...record.list, , record];
  yield limit;
  const kept = [, record.list, , record];
  yield kept.length;
}
console.log([() => spreads(2)].map(make => make().next().value));
const ofSpreads = { get value() { spreads.prototype[pick("return")] = override; return 1; } };
function walkSpreads() {
  for (const value of spreads(4)) if (ofSpreads.value) return value;
}
for (let turn = 0; turn < 2; turn++) console.log(walkSpreads());
