function describe(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return value.length > 120 ? JSON.stringify(value.slice(0, 60)) + " and " + (value.length - 60) + " more characters" : JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const prototype = Object.getPrototypeOf(value);
  const parts = [];
  for (const key of Reflect.ownKeys(value)) {
    const property = Reflect.getOwnPropertyDescriptor(value, key);
    parts.push(String(key) + ": " + ("value" in property ? describe(property.value) : "accessor"));
  }
  if (value instanceof Set || value instanceof Map) for (const entry of value) parts.push(describe(entry));
  if (parts.length > 16) parts.splice(8, parts.length - 16, "and " + (parts.length - 16) + " more");
  const name = prototype === null ? "no prototype" : prototype.constructor.name;
  return name + (Array.isArray(value) ? " [" + parts.join(", ") + "]" : " {" + parts.join(", ") + "}");
}

function attempt(label, run) {
  try {
    console.log(label + ": " + describe(run()));
  } catch (error) {
    console.log(label + ": threw " + error.constructor.name);
  }
}

const TABLE = [1, 2, 3];
const WORDS = ["a", "b", "c"];
const DOUBLES = [1.5, 2.5, 3.5];
const NESTED = [[1, 2], [3, 4]];
const EMPTY = [];

function fresh() {
  return [1, 2, 3];
}

function freshWords() {
  return ["a", "b", "c"];
}

function freshDoubles() {
  return [1.5, 2.5, 3.5];
}

function freshNested() {
  return [[1, 2], [3, 4]];
}

function freshEmpty() {
  return [];
}

function freshObjects() {
  return [{ id: 1 }, { id: 2 }];
}

const changes = {
  push: list => list.push(9),
  pop: list => list.pop(),
  store: list => { list[0] = "stored"; },
  storeADouble: list => { list[0] = 0.5; },
  append: list => { list[list.length] = 9; },
  truncate: list => { list.length = 1; },
  clear: list => { list.length = 0; },
  sort: list => list.sort((a, b) => (a < b ? 1 : -1)),
  reverse: list => list.reverse(),
  fill: list => list.fill(0),
  shift: list => list.shift(),
  unshift: list => list.unshift(0),
  splice: list => list.splice(0, 1),
  remove: list => delete list[1],
  freeze: list => Object.freeze(list),
  name: list => { list.name = "named"; },
  relink: list => Object.setPrototypeOf(list, null),
  define: list => Object.defineProperty(list, 0, { get: () => "got" }),
  inner: list => { if (typeof list[0] === "object") list[0][0] = "inner"; },
};

const makers = { fresh, freshWords, freshDoubles, freshNested, freshEmpty, freshObjects };

for (const maker in makers) {
  const pristine = describe(makers[maker]());
  for (const change in changes) {
    const list = makers[maker]();
    let answer;
    try {
      changes[change](list);
      answer = describe(list);
    } catch (error) {
      answer = "threw " + error.constructor.name;
    }
    const next = describe(makers[maker]());
    console.log(maker + ", " + change + ": " + answer + "; the next one is " + (next === pristine ? "untouched" : "WRONG " + next));
  }
  console.log(maker + ": two calls give two arrays: " + (makers[maker]() !== makers[maker]()));
}

function inALoop() {
  const all = [];
  for (let i = 0; i < 3; i++) {
    const list = [1, 2, 3];
    list.push(i);
    all.push(list);
  }
  return all;
}
attempt("a literal in a loop", inALoop);

function defaulted(list = [1, 2, 3]) {
  list.push(4);
  return list;
}
attempt("a literal as a default, twice", () => [defaulted(), defaulted()]);

function copies() {
  const source = [1, 2, 3];
  const sliced = source.slice();
  const spread = [...source];
  const concatenated = source.concat();
  const from = Array.from(source);
  sliced.push("sliced");
  spread.push("spread");
  concatenated.push("concatenated");
  from.push("from");
  source[0] = "source";
  return [source, sliced, spread, concatenated, from];
}
attempt("copies of a literal", copies);

attempt("the tables before", () => [TABLE, WORDS, DOUBLES, NESTED, EMPTY]);
TABLE.push(4);
WORDS[0] = 1;
DOUBLES.length = 1;
NESTED[0].push("inner");
EMPTY.push("no longer empty");
attempt("the tables after", () => [TABLE, WORDS, DOUBLES, NESTED, EMPTY]);
attempt("literals that look like the tables", () => [[1, 2, 3], ["a", "b", "c"], [1.5, 2.5, 3.5], [[1, 2], [3, 4]], []]);
attempt("the functions still give the originals", () => [fresh(), freshWords(), freshDoubles(), freshNested(), freshEmpty()]);
