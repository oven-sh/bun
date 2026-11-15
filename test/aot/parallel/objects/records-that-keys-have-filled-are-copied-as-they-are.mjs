// COUNTER: CopiesCollectedByName <= 60
// COUNT: operation:operationAOTCopyObject <= 1000
// Records that gained names out of data are copied, taken apart, assigned and written as JSON again and again, while some gain, lose and change names.
const names = JSON.parse('["alpha","beta","gamma","delta"]');
const make = [() => ({ id: 1, label: "one" }), () => ({ id: 2, size: 2.5, late: undefined }), () => ({})];
const records = [];
for (let i = 0; i < 12; i++) {
  const record = make[i % 3]();
  record["own" + i] = i;
  if (i % 2) record.late = "field";
  for (let k = 0; k < i % 5; k++) record[names[k] + (i % 4)] = [k];
  records.push(record);
}
const copy = record => ({ ...record });
const withMore = (record, more) => ({ ...record, more });
const without = record => { const { id, ...rest } = record; return rest; };
const assigned = record => Object.assign({}, record);
const onto = record => Object.assign({ id: 0, first: true }, record);
let hash = 7;
const mix = text => { for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0; };
for (let round = 0; round < 60; round++) {
  for (let i = 0; i < records.length; i++) {
    const record = records[i], all = [copy(record), withMore(record, round), without(record), assigned(record), onto(record), copy(copy(record))];
    if (round % 15 === 0) mix(all.map(each => JSON.stringify(each)).join());
    all[0]["own" + i] = -1;
    all[3].added = round;
    delete all[5]["own" + i];
    mix(Object.keys(record).join() + JSON.stringify(record).length);
  }
}
console.log(hash, records.map(record => Object.keys(record).join("+")).join(" "));
records[3][names[0] + "again"] = 1;
delete records[4]["own4"];
Object.freeze(records[5]);
Object.defineProperty(records[6], "own6", { get() { return "got"; }, enumerable: true });
Object.setPrototypeOf(records[7], { above: 1 });
records[8][Symbol.for("s")] = 8;
records[9][3] = "three";
for (const record of records.slice(3, 10)) console.log(JSON.stringify([copy(record), without(record), assigned(record), onto(record)]), Object.isFrozen(copy(record)), copy(record).above, Reflect.ownKeys(copy(record)).length);
