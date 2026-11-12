// STATISTIC: DictionariesExpectedInLoops >= 4
// STATISTIC: ElementsOverwrittenInLoops >= 2
// What a program stores under numbers makes no list of a dictionary: its elements are read and overwritten in place, whatever they are.
const out = [];
const objects = {}, texts = {}, whole = {}, mixed = {}, rows = {}, halves = {};
for (let i = 0; i < 10; i++) objects[i] = { v: i };
for (let i = 0; i < 10; i++) texts[i] = `text ${i}`;
for (let i = 0; i < 10; i++) whole[i] = i;
for (let i = 0; i < 10; i++) mixed[i] = i % 3 ? i : `m${i}`;
for (let i = 0; i < 10; i++) halves[i] = i / 2;
for (let i = 0; i < 3; i++) { const row = rows[i] = {}; for (let j = 0; j < 4; j++) row[j] = i * j; }
delete texts[4];
function sumOfObjects(turns) {
  let n = 0;
  for (let k = 0; k < turns; k++) n += objects[k % 10].v;
  return n;
}
function lengths(turns) {
  let n = 0;
  for (let k = 0; k < turns; k++) n += texts[k % 10]?.length ?? 100;
  return n;
}
function overwrite(turns) {
  let n = 0;
  for (let k = 0; k < turns; k++) { whole[k % 10] = k & 7; n += whole[(k + 1) % 10]; }
  return n;
}
function overwriteAnything(turns) {
  for (let k = 0; k < turns; k++) mixed[k % 12] = k % 5 === 0 ? { k } : k % 5 === 1 ? `${k}` : k / 2;
  return Object.values(mixed).map(v => typeof v).join();
}
function count(turns) {
  for (let k = 0; k < turns; k++) whole[k % 10] += 1;
  return Object.values(whole).join();
}
function twoLevels(turns) {
  let n = 0;
  for (let k = 0; k < turns; k++) n += rows[k % 3][k % 4];
  return n;
}
function read(table, k) { return table[k % 10]; }
function handed(turns) {
  let n = 0;
  for (let k = 0; k < turns; k++) n += read(k & 1 ? whole : halves, k);
  return n;
}
function frozen() {
  const table = {};
  for (let i = 0; i < 4; i++) table[i] = i;
  Object.freeze(table);
  let failed = 0;
  for (let k = 0; k < 8; k++) { try { table[k % 5] = 9; } catch { failed++; } }
  return failed + Object.values(table).join();
}
function watched() {
  const table = {}, seen = [];
  for (let i = 0; i < 4; i++) table[i] = i;
  Object.defineProperty(table, 2, { set(v) { seen.push(v); }, get() { return "got"; } });
  for (let k = 0; k < 8; k++) table[k % 4] = k;
  return seen.join() + Object.keys(table).join() + table[2];
}
function list(turns) {
  const table = [1, 2, 3, 4];
  for (let k = 0; k < turns; k++) table[k % 4] = k % 7 ? k : "s";
  return table.join();
}
out.push(sumOfObjects(1000), lengths(1000), overwrite(1000), overwriteAnything(60), count(100), twoLevels(120), handed(100), frozen(), watched(), list(40));
objects[3] = { v: "late" };
out.push(sumOfObjects(12), Object.keys(mixed).length, whole[10], halves[3]);
console.log(out.join("\n"));
