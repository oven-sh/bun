// Rests and spreads whose fields only the copy fills: which names the new object has, in which order, and what they hold.
const lines = [];
const show = (label, value) => lines.push(label + " " + JSON.stringify(value) + " " + Object.keys(value).join());

const records = [
  { id: 6, name: "six", secret: "w", age: 20 },
  { secret: "y", id: 8, name: "eight" },
  { name: "nine", secret: "z", id: 9, age: 3, more: 1 },
];
const kept = [];

function restOf(i) {
  const { secret, ...visible } = records[i % 3];
  kept[i & 3] = visible;
  return visible.id + visible.name.length + secret.length;
}
function restThatGetsTheNameBack(i) {
  const { secret, ...visible } = records[i % 3];
  if (i % 5 === 0) visible.secret = i;
  kept[i & 3] = visible;
  return "secret" in visible ? visible.secret : -1;
}
function restWithoutAnotherName(i) {
  const { id, ...others } = records[i % 3];
  kept[i & 3] = others;
  return id + others.secret.length + ("id" in others ? 100 : 0);
}
function restWithoutTwoNames(i) {
  const { id, name, ...others } = records[i % 3];
  kept[i & 3] = others;
  return id + name.length + (others.age ?? 7) + (others.more ?? 9);
}
function restUnderAComputedKey(i, key) {
  const { [key]: taken, ...others } = records[i % 3];
  kept[i & 3] = others;
  return String(taken) + Object.keys(others).length;
}

let sum = 0;
for (let round = 0; round < 40; round++) {
  for (let i = 0; i < 60; i++) {
    sum = (sum + restOf(i) + restThatGetsTheNameBack(i) + restWithoutAnotherName(i) + restWithoutTwoNames(i)) | 0;
    sum = (sum + restUnderAComputedKey(i, i & 1 ? "age" : "name").length) | 0;
  }
}
lines.push("sum " + sum);
for (let i = 0; i < 6; i++) {
  restOf(i);
  show("rest", kept[i & 3]);
  restThatGetsTheNameBack(i);
  show("gets the name back", kept[i & 3]);
  restWithoutAnotherName(i);
  show("without id", kept[i & 3]);
  restWithoutTwoNames(i);
  show("without id and name", kept[i & 3]);
  restUnderAComputedKey(i, "more");
  show("without more", kept[i & 3]);
}

// Integers at the ends of 32 bits, out of fields that always hold one into fields that may hold none.
const ends = [
  { tag: "a", low: -2147483648, high: 2147483647 },
  { tag: "b", low: -2147483647, high: 2147483646, extra: -2147483646 },
  { tag: "c", low: -2147483645, high: 0, extra: -2147483644 },
  { tag: "d", low: -2147483643, high: -1 },
];
function restOfEnds(i) {
  const { tag, ...numbers } = ends[i & 3];
  kept[i & 3] = numbers;
  return tag.length + (numbers.low % 7) + (numbers.high % 7) + ((numbers.extra ?? 3) % 7);
}
for (let i = 0; i < 2000; i++) sum = (sum + restOfEnds(i)) | 0;
lines.push("sum " + sum);
for (let i = 0; i < 4; i++) show("ends", kept[i]);

// Nobody lists the keys of these.
const unlisted = [];
function overAField(i) {
  const merged = { id: -1, age: -2, ...records[i % 3] };
  unlisted[i & 3] = merged;
  return merged.id + merged.age + merged.name.length;
}
function underAField(i) {
  const merged = { ...records[i % 3], id: -1 };
  unlisted[i & 3] = merged;
  return merged.id + (merged.age ?? 5) + merged.name.length;
}
for (let i = 0; i < 3000; i++) sum = (sum + overAField(i) + underAField(i)) | 0;
lines.push(
  "sum " + sum + " " + unlisted[0].id + " " + unlisted[1].age + " " + unlisted[2].more + " " + unlisted[3].secret,
);

// What is no record.
const others = [
  {
    id: 1,
    get name() {
      return "got " + this.id;
    },
    secret: "s",
  },
  Object.freeze({ id: 2, name: "frozen", secret: "t" }),
  Object.defineProperty({ id: 3, secret: "u" }, "name", { value: "hidden", enumerable: false }),
  Object.assign(Object.create({ inherited: 1 }), { id: 4, name: "below", secret: "v" }),
  "text",
  7,
  [5, 6],
];
function restOfAnything(value) {
  const { secret, ...visible } = value;
  return visible;
}
for (let round = 0; round < 300; round++) for (const other of others) kept[round & 3] = restOfAnything(other);
for (const other of others) show("anything", restOfAnything(other));
for (const nothing of [undefined, null]) {
  try {
    restOfAnything(nothing);
  } catch (error) {
    lines.push(error.constructor.name);
  }
}
const visible = restOfAnything(others[1]);
visible.id = 20;
delete visible.name;
visible.name = "again";
show("a copy of a frozen object is not frozen", visible);

console.log(lines.join("\n"));
