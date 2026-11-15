// STATISTIC: ImageFunctionsEmitted <= 60
function kindOf(thing) {
  if (thing instanceof Function) return 0;
  if (thing instanceof Set) return 1;
  if (thing instanceof Map) return 2;
  if (thing instanceof Error) return 3;
  return 4;
}
const things = [() => 1, new Set(), new Map(), new RangeError("made up"), {}, 1, "text", null];
let functions = 0, sets = 0, maps = 0, errors = 0, others = 0;
for (let turn = 0; turn < 3000; turn++) {
  const kind = kindOf(things[turn % things.length]);
  if (kind === 0) functions++;
  else if (kind === 1) sets++;
  else if (kind === 2) maps++;
  else if (kind === 3) errors++;
  else others++;
}
console.log(functions, sets, maps, errors, others);
