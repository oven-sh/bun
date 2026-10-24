// Dictionaries are built name by name, each name asked for first, again and again from the same lists: the objects go through the same shapes every time.
// Between the rounds whole collections run, names are deleted, and a list is long enough that its object changes the way it keeps its names.
function namesOf(list, count) {
  const names = [];
  for (let k = 0; k < count; k++) names.push(k % 5 === 4 ? "a_rather_long_name_of_list_" + list + "_number_" + k : "n" + list + "_" + k);
  return names;
}
function fresh(text) {
  return JSON.parse(JSON.stringify({ text })).text;
}
function piece(text) {
  return fresh("<<" + text + ">>").slice(2, -2);
}
function buildByRead(names, prototype) {
  const seen = Object.create(prototype);
  let added = 0;
  for (let k = 0; k < names.length; k++) {
    const key = names[k];
    if (seen[key] !== undefined) continue;
    seen[key] = k;
    added++;
  }
  return [seen, added];
}
function buildByIn(names, prototype) {
  const seen = Object.create(prototype);
  let added = 0;
  for (let k = 0; k < names.length; k++) {
    const key = names[k];
    if (key in seen) continue;
    seen[key] = k;
    added++;
  }
  return [seen, added];
}
function buildByHasOwn(names, prototype) {
  const seen = Object.create(prototype);
  let added = 0;
  for (let k = 0; k < names.length; k++) {
    const key = names[k];
    if (Object.hasOwn(seen, key)) continue;
    seen[key] = k;
    added++;
  }
  return [seen, added];
}
function sumOf(seen, names) {
  let sum = 0;
  for (let k = 0; k < names.length; k++) {
    const value = seen[names[k]];
    sum = (sum * 31 + (value === undefined ? 7 : typeof value === "string" ? value.length : value)) % 1000003;
  }
  return sum;
}
function replaceAll(seen, names, by) {
  for (let k = 0; k < names.length; k++) if (names[k] in seen) seen[names[k]] = seen[names[k]] + by;
}

const above = { n0_1: "above", n1_2: "above", toString: undefined };
const builders = [buildByRead, buildByIn, buildByHasOwn];
const counts = [1, 3, 12, 40, 70, 300];
const kept = [];
for (let round = 0; round < 6; round++) {
  const line = [];
  for (let list = 0; list < counts.length; list++) {
    const names = namesOf(list, counts[list]);
    const twice = names.concat(names.slice(0, names.length >> 1));
    const asked = round % 3 === 1 ? twice.map(fresh) : round % 3 === 2 ? twice.map(piece) : twice;
    const others = namesOf(list + 1, counts[list]);
    for (const build of builders) {
      for (const prototype of [null, Object.prototype, above]) {
        const [seen, added] = build(asked, prototype);
        let sum = sumOf(seen, names) + sumOf(seen, others) * 3 + added * 5;
        replaceAll(seen, asked, round);
        sum += sumOf(seen, names) * 7;
        if (round & 1) {
          delete seen[names[names.length >> 1]];
          sum += sumOf(seen, asked) * 11 + (names[names.length >> 1] in seen ? 1 : 0);
          seen[names[names.length >> 1]] = -1;
          sum += sumOf(seen, names) * 13;
        }
        sum += Object.keys(seen).length;
        line.push(sum % 1000003);
        if ((round + list) % 4 === 0) kept.push(seen);
      }
    }
    if (round >= 2) Bun.gc(true);
    // What was kept is asked once its shapes have lost what a collection takes from them.
    let sumOfKept = 0;
    for (const seen of kept) sumOfKept = (sumOfKept + sumOf(seen, names) + sumOf(seen, others)) % 1000003;
    line.push(sumOfKept);
  }
  console.log(round, line.join(" "));
}
