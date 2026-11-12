// The pieces of a known string between the places of a known separator are constants.
// STATISTIC: KnownStringsSplit >= 1
const rounds = JSON.parse("40");
function get(o, path) { let x = o; for (const name of path.split(".")) x = x?.[name]; return x; }
function find(o, path) { let x = o; for (const name of path.split("/")) x = x?.[name] ?? "none"; return x; }
const deep = { a: { b: { c: 5 } }, "": { "": 7 } };
let sum = 0, found = "";
for (let i = 0; i < rounds; i++) { deep.a.b.c = i; sum += get(deep, "a.b.c"); if (i < 4) found += find(deep, i % 2 ? "a/x/c" : "/"); }
console.log(sum, found);
const said = [];
for (let i = 0; i < rounds; i++) {
  const list = "one, two, three".split(", ");
  list.push("four"); list[0] += i; said.push(list.join("-"), list.length);
  const same = "one, two, three".split(", "); said.push(same[0], same === list, same.length, same.map(x => x.length).join());
  for (const piece of "a--b----c".split("--")) said.push("[" + piece + "]");
  for (const piece of "é|\u{1F600}|x".split("|")) said.push(piece.length);
  said.push("abc".split("abc").length, "abc".split("x")[0], "x".split("x").join("+"), "xx".split("x").length, "a.b.c.d.e.f.g.h.i.j".split(".").length, "a.b".split(".", 1).length, "abc".split("").length);
  const [head, ...tail] = "k=v=w".split("="); said.push(head, tail.join(), tail.length);
  const changed = "p,q".split(","); changed.length = 1; changed.x = i; said.push(changed.join(), Object.keys(changed).join());
}
let hash = 0; for (const c of said.join("|")) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) | 0;
console.log(hash, said.length, said.slice(0, 30).join("|"));
