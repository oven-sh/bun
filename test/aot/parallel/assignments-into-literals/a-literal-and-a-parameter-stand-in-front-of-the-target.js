// STATISTIC: OwnKeyWalksExpanded >= 1
// A literal and a parameter stand in front of the target: the way where the keys of the parameter are as expected and the way where they are not.
// STATISTIC: ObjectAssignCallsExpanded >= 1
let work = 0;
function merge(given, depth) {
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const own = { depth, width: 1, color: false };
  const wide = { width: depth * 10 };
  Object.assign(own, wide, given, own);
  return own.depth + "|" + own.width + "|" + own.color;
}
// The source is written in the call: its field is a store.
function mergeWritten(given, depth) {
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const own = { depth, width: 1, color: false };
  Object.assign(own, { width: depth * 10 }, given, own);
  return own.depth + "|" + own.width + "|" + own.color;
}
function fresh(depth) { return { depth: depth + 100, color: true }; }
const deeds = [
  x => x,
  () => ({ color: true, depth: 8 }),
  () => JSON.parse('{"color":true,"depth":9}'),
  x => { x[0] = "zero"; return x; },
  x => { x.extra = 6; return x; },
];
let sum = 0;
for (let i = 0; i < 300; i++) sum += merge(fresh(i), i).length + mergeWritten(fresh(i), i).length;
console.log(sum);
for (const deed of deeds) console.log(merge(deed(fresh(1)), 1), mergeWritten(deed(fresh(1)), 1));
