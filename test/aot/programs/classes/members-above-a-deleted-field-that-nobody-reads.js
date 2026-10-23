// As members-above-a-deleted-field-answer.js, but nothing reads the fields or asks for the keys: only what the members above do shows.
const lines = [];
class Above {
  set s(value) { lines.push("s got " + value); }
  set t(value) { lines.push("t got " + value); }
}
class Below extends Above { s = 1; t = 2; u = 3; }
function viaAssign(o, value) { Object.assign(o, { s: value, t: value, u: value }); }
function viaStores(o, value) { o.s = value; o.t = value; o.u = value; }
function viaReflect(o, value) { Reflect.set(o, "s", value); Reflect.set(o, "t", value); Reflect.set(o, "u", value); }
function viaComputed(o, value) { for (const name of ["s", "t", "u"]) o[name] = value; }
function viaEntries(o, value) { for (const [name, v] of Object.entries({ s: value, t: value, u: value })) o[name] = v; }
const ways = [viaAssign, viaStores, viaReflect, viaComputed, viaEntries];
function round(first, second) {
  const o = new Below;
  first(o, 1);
  delete o.s;
  second(o, 2);
  delete o.t;
  first(o, 3);
  second(o, 4);
}
for (let turn = 0; turn < 30; turn++) {
  if (turn && turn < 29)
    lines.length = 0;
  for (const first of ways) {
    for (const second of ways) {
      lines.push(first.name + " " + second.name);
      round(first, second);
    }
  }
}
console.log(lines.join("\n"));
