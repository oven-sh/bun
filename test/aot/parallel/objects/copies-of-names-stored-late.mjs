// A record is copied by a spread, gets a name that the program writes and, behind several calls, names that nobody knows. An object of the global object holds it too.
// Under: --aot-check=FlowFixpoint: the copy asked what the record holds under unknown names and watched what it holds beside its fields at all, so it was not told of the late names.
const out = [];
const record = { first: 1 };
const names = JSON.parse('["third", "fourth"]');
let afterFirst, afterSecond, afterThird, afterFourth;

function describe(copy) {
  return Object.keys(copy).join(" ") + " " + copy.own;
}
function copied(source) {
  return describe({ ...source, own: 10 });
}
function first() {
  afterFirst = second;
  afterFirst();
}
function second() {
  afterSecond = third;
  afterSecond();
}
function third() {
  afterThird = fourth;
  afterThird();
}
function fourth() {
  for (const name of names) record[name] = 3;
}

record.second = 2;
out.push(copied(record));
const box = { held: undefined };
globalThis.box = box;
box.held = record;
first();
out.push(copied(record));
globalThis[JSON.parse('["box"]')[0]].held.fifth = "unseen";
out.push(copied(record));
delete globalThis.box.held.third;
out.push(copied(record));
console.log(out.join("\n"));
