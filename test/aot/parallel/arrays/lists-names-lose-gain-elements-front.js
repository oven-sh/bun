// Lists with names of their own lose and gain elements at the front.
const kinds = {
  integers: at => at,
  fractions: at => at + 0.5,
  texts: at => "t" + at,
  objects: at => ({ at }),
};
const show = value => (typeof value === "object" && value !== null ? "o" + value.at : String(value));
let digest = 0;
function note(text) {
  for (let at = 0; at < text.length; at++) digest = (Math.imul(digest, 31) + text.charCodeAt(at)) | 0;
}
function describe(list, names) {
  let text = list.length + ":";
  for (let at = 0; at < list.length; at += 37) text += show(list[at]) + ",";
  text += show(list[list.length - 1]) + ";";
  for (let name = 0; name < names; name++) text += show(list["name" + name]) + ",";
  text += Object.keys(list).length;
  note(text);
}
function exercise(kind, length, names) {
  const make = kinds[kind];
  const list = [];
  for (let at = 0; at < length; at++) list.push(make(at));
  let named = 0;
  const addNames = upTo => {
    for (; named < upTo; named++) list["name" + named] = make(1000000 + named);
  };
  addNames(names);
  describe(list, named);
  for (let turn = 0; turn < length / 4; turn++) note(show(list.shift()));
  describe(list, named);
  addNames(names + 3);
  for (let turn = 0; turn < length / 4; turn++) note(show(list.shift()));
  describe(list, named);
  for (let turn = 0; turn < length / 2; turn++) list.unshift(make(-turn));
  describe(list, named);
  addNames(names + 9);
  list.unshift(make(-1), make(-2), make(-3));
  note(list.splice(0, 5).map(show).join());
  describe(list, named);
  delete list.name0;
  for (let turn = 0; turn < 40; turn++) {
    note(show(list.shift()));
    list.push(make(turn));
  }
  describe(list, named);
  list.name0 = make(7);
  while (list.length > 100) note(show(list.shift()));
  describe(list, named);
  while (list.length) note(show(list.shift()));
  describe(list, named);
  return list;
}
const kept = [];
for (const kind of Object.keys(kinds)) {
  for (const length of [130, 200, 1000, 5000]) {
    for (const names of [0, 1, 4, 5, 9, 17, 40, 150]) kept.push(exercise(kind, length, names));
  }
}
class Queue extends Array {}
const queue = new Queue();
for (let at = 0; at < 3000; at++) queue.push({ at });
queue.owner = { at: -1 };
while (queue.length > 10) note(show(queue.shift()));
note(show(queue.owner) + queue.length);
console.log(digest, kept.length);
