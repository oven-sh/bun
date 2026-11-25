// Object.assign() lists the keys of the literal. Nothing but the copy has the name "constructor" from the program.
const pick = (holder, key) => holder?.[key];
const one = JSON.parse("1");
class Shelf {}
function list(object) {
  for (const key in object) if (key.length === 11) return key;
}
const named = { label: 2 };
Object.assign(named, { constructor: one });
const keys = [
  list(Object.assign(Object.create(null), { constructor: 1 })),
  list(Object.assign(new Map(), { first: one }, { constructor: one })),
  list(Object.assign(new Shelf(), { constructor: one })),
  list(named),
];
for (const key of keys) {
  console.log(pick(function* () {}, key)(JSON.parse('"yield 7"'))().next().value, pick(function () {}, key)(JSON.parse('"return 8"'))());
}
