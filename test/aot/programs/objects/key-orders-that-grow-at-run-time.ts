// Objects of one declared type get their optional fields in orders that the build has not seen, one field at a time: the order of an object grows, several objects share an order while they agree,
// part where they differ, and none of them sees a key that another one added.
type Options = {
  a?: number; b?: number; c?: number; d?: number; e?: number; f?: number; g?: number; h?: number; i?: number; j?: number;
  k?: number; l?: number; m?: number; n?: number; o?: number; p?: number; q?: number; r?: number; s?: number; t?: number;
};
type Name = keyof Options;

function parsed(names: string): Options {
  return JSON.parse("{" + [...names].map((name, index) => JSON.stringify(name) + ":" + index).join(",") + "}");
}
function copyOf(from: Options): Options {
  return { ...from };
}
function add(to: Options, names: string): Options {
  for (const name of names) to[name as Name] = name.charCodeAt(0);
  return to;
}
function show(label: string, object: Options): void {
  console.log(label, Object.keys(object).join(""), JSON.stringify(object).length, Object.values(object).reduce((sum, value) => sum + value!, 0));
}

const first = copyOf(parsed("tsrqponm"));
const same = copyOf(parsed("tsrqponm"));
const shorter = copyOf(parsed("tsrq"));
const other = copyOf(parsed("tsrqabcd"));
const all: [string, Options][] = [["first", first], ["same", same], ["shorter", shorter], ["other", other]];
for (const [label, object] of all) show(label, object);

add(first, "lk");
for (const [label, object] of all) show("after first grew: " + label, object);
add(same, "kl");
for (const [label, object] of all) show("after same parted: " + label, object);
add(shorter, "ponmlk");
add(other, "e");
for (const [label, object] of all) show("after shorter followed: " + label, object);
add(first, "jihgfedcba");
add(shorter, "jihgfedcba");
add(same, "abcdefghij");
for (const [label, object] of all) show("full: " + label, object);

delete first.t;
add(first, "t");
delete shorter.a;
for (const [label, object] of all) show("after deletes: " + label, object);

const empty: Options = {};
const many: Options[] = [];
for (let round = 0; round < 6; round++) {
  const object = copyOf(empty);
  add(object, "abcdefghijklmnopqrst".slice(round * 3) + "abcdefghijklmnopqrst".slice(0, round * 3));
  many.push(object);
}
many.forEach((object, index) => show("rotated " + index, object));
