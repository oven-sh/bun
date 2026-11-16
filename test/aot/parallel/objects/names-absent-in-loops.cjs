// `"name" in record` in a loop, where no record of the kind has the name: the site's newest answer says so in line.
// STATISTIC: AbsencesAnsweredInline >= 2
const texts = ['{"id":1,"age":4}', '{"age":2,"score":5,"id":3}', '{"nope":1,"id":2}', '{}', '[1,2]', '{"id":7,"deep":{"nope":0}}'];
const said = [];
function count(list) { let t = 0; for (const u of list) { if ("age" in u) t += 1; if (!("nope" in u)) t += 10; if ("toString" in u) t += 100; if ("later" in u) t += 1000; } return t; }
function only(list) { let t = 0; for (let i = 0; i < list.length; i++) if (!("missing" in list[i])) t++; return t; }
function make(text, n) { const all = []; for (let i = 0; i < n; i++) all.push(JSON.parse(text)); return all; }
for (const text of texts) said.push(count(make(text, 20)), only(make(text, 9)));
const mixed = texts.flatMap(text => make(text, 4));
for (let round = 0; round < 6; round++) {
  said.push(count(mixed), only(mixed));
  if (round === 0) mixed[1].later = 1;
  if (round === 1) Object.setPrototypeOf(mixed[2], { missing: undefined });
  if (round === 2) mixed[5].missing = undefined;
  if (round === 3) delete mixed[0].age;
  if (round === 4) Object.defineProperty(mixed[6], "nope", { get() { throw new Error("not read"); } });
}
const one = make(texts[0], 12);
for (let round = 0; round < 8; round++) {
  said.push(count(one), only(one));
  if (round === 2) one[3] = new Proxy({}, { has(t, k) { return k === "missing"; } });
  if (round === 3) one[4] = [1, 2, 3];
  if (round === 4) one[5] = Object.create(null);
  if (round === 5) one[6] = class { static missing = 1; };
  if (round === 6) { class Below { get missing() { return 1; } } one[7] = new Below(); }
}
for (const odd of [5, "text", undefined, null, Symbol.iterator, 5n, true]) { try { said.push(only([one[0], odd])); } catch (error) { said.push(error.name); } }
const proto = {}; const below = make(texts[0], 10).map(u => Object.setPrototypeOf(u, proto));
said.push(only(below)); proto.missing = 1; said.push(only(below)); delete proto.missing; said.push(only(below)); Object.setPrototypeOf(proto, { missing: 0 }); said.push(only(below));
console.log(said.join(" "));
