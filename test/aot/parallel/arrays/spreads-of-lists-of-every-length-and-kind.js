// `[...list]` and `[...list, last]` where nobody knows what the list holds: one piece of code makes the copy and fills it.
// Every kind of storage, with and without holes, at the lengths where that code hands over to the slow way.
const lengths = [0, 1, 2, 3, 7, 8, 63, 64, 65, 125, 126, 127, 128, 129, 300];

const makers = {
  integers: k => k - 3,
  fractions: k => k + 0.5,
  wholeFractions: k => (k % 3 ? k : k + 0.25),
  minusZero: k => (k % 2 ? -0 : 1.5),
  texts: k => "t" + k,
  objects: k => ({ k }),
  mixed: k => (k % 4 === 0 ? null : k % 4 === 1 ? "s" : k % 4 === 2 ? k / 2 : undefined),
};

function listOf(make, length, gap) {
  const list = [];
  for (let k = 0; k < length; k++) list.push(make(k));
  if (gap >= 0 && gap < length) delete list[gap];
  return list;
}

function copy(list) {
  return [...list];
}

function copyAndOneMore(list, last) {
  return [...list, last];
}

function twice(list) {
  return [...list, ...list];
}

function show(value) {
  if (value === undefined) return "u";
  if (value === null) return "n";
  if (typeof value === "object") return "o" + value.k;
  return Object.is(value, -0) ? "-0" : String(value);
}

function digest(list) {
  let text = list.length + ":";
  let holes = 0;
  for (let k = 0; k < list.length; k++) {
    if (!(k in list)) holes++;
    if (k < 4 || k > list.length - 4) text += show(list[k]) + ",";
  }
  return text + " holes " + holes;
}

for (const name in makers) {
  for (const length of lengths) {
    for (const gap of [-1, 0, length >> 1, length - 1]) {
      const list = listOf(makers[name], length, gap);
      const a = copy(list);
      const b = copyAndOneMore(list, name);
      const c = twice(list);
      a.push("pushed");
      b[b.length + 1] = "past the end";
      console.log(name, length, gap, "|", digest(a), "|", digest(b), "|", digest(c), "|", digest(list));
    }
  }
}

// Shared with a literal, frozen, with a length set by hand, and with a name beside the elements.
const literal = () => [1, 2, 3];
const frozen = Object.freeze([1.5, 2.5]);
const stretched = [1, 2];
stretched.length = 5;
const named = Object.assign(["a", "b"], { name: "n" });
for (const list of [
  literal(),
  frozen,
  stretched,
  named,
  new Array(3),
  new Array(200),
  Array.from({ length: 4 }, (_, k) => k * k),
])
  console.log(
    digest(copy(list)),
    "|",
    digest(copyAndOneMore(list, 9)),
    "|",
    Object.keys(copy(list)).length,
    Object.isFrozen(copy(list)),
  );
