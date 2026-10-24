/**
 * @param {unknown} value
 * @returns {string}
 */
function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

/**
 * @param {string} label
 * @param {() => unknown} run
 */
function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

/**
 * @template T
 * @param {T} model
 * @param {string} text
 * @returns {T}
 */
function parsedLike(model, text) {
  return JSON.parse(text);
}

/**
 * @template T
 * @param {string} text
 * @returns {T[]}
 */
function listOf(text) {
  return JSON.parse(text);
}

/**
 * @template {{ id: number }} T
 * @param {T} row
 * @returns {number}
 */
function nextId(row) {
  return row.id + 1;
}

/**
 * @template T
 */
class Box {
  /** @param {T} content */
  constructor(content) {
    /** @type {T} */
    this.content = content;
  }
  /** @returns {T} */
  get() {
    return this.content;
  }
  /** @param {T} content */
  set(content) {
    this.content = content;
  }
}

/**
 * @template T
 * @param {Box<T>} box
 * @param {string} text
 */
function fill(box, text) {
  box.set(JSON.parse(text));
}

/**
 * @template T
 * @template {keyof T} K
 * @param {T} object
 * @param {K} key
 * @param {T[K]} value
 */
function store(object, key, value) {
  object[key] = value;
}

/**
 * @param {number} n
 * @returns {number}
 */
function plusOne(n) {
  return n + 1;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += parsedLike(0, "1") + nextId({ id: i }) + new Box(i).get() + listOf("[1]").length;
console.log("2000 honest rounds: " + warm);

for (const text of ["1", '"1"', "null", "true", "[1]", "{}"]) {
  attempt("like a number, " + text, () => [parsedLike(0, text) + 1, plusOne(parsedLike(0, text)), typeof parsedLike(0, text)]);
  attempt("like a text, " + text, () => [parsedLike("", text) + "!", parsedLike("", text).length]);
  attempt("like a point, " + text, () => [parsedLike({ x: 0, y: 0 }, text).x, typeof parsedLike({ x: 0, y: 0 }, text)]);
  attempt("a box of numbers is filled with " + text, () => {
    const box = new Box(1);
    const before = box.get() + 1;
    fill(box, text);
    return [before, box.get() + 1, plusOne(box.content)];
  });
  attempt("a row whose id is " + text, () => nextId(JSON.parse('{"id":' + text + "}")));
}

attempt("a list of numbers", () => {
  /** @type {number[]} */
  const numbers = listOf('[1,"2",null]');
  return [numbers.map(plusOne), numbers.length];
});
attempt("a list that is none", () => {
  /** @type {number[]} */
  const numbers = listOf('{"length":1}');
  return [numbers.length, numbers[0]];
});
attempt("a list that is none, a method", () => {
  /** @type {number[]} */
  const numbers = listOf('{"length":1}');
  return numbers.map(plusOne);
});
attempt("a key that is one of two", () => {
  const row = { id: 1, name: "n" };
  /** @type {"id" | "name"} */
  const key = JSON.parse('"id"');
  store(row, key, "text");
  return [row.id, typeof row.id, row.id + 1, nextId(row), JSON.stringify(row)];
});
attempt("a box seen as a box of something wider", () => {
  const numbers = new Box(1);
  /** @type {Box<number | string>} */
  const wider = numbers;
  wider.set("text");
  return [numbers.get(), numbers.get() + 1, plusOne(numbers.content)];
});

export {};
