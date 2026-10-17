// A name is deleted from a prototype in dictionary mode and stored again: reads by name through an heir answer with that name's value.
const names = ["a", "b", "c", "d", "e", "f"];
const read = [o => o.a, o => o.b, o => o.c, o => o.d, o => o.e, o => o.f], write = [(o, v) => { o.a = v; }, (o, v) => { o.b = v; }, (o, v) => { o.c = v; }, (o, v) => { o.d = v; }, (o, v) => { o.e = v; }, (o, v) => { o.f = v; }], remove = [o => delete o.a, o => delete o.b, o => delete o.c, o => delete o.d, o => delete o.e, o => delete o.f];
const all = o => read.map(r => String(r(o))).join() + " | " + names.map(n => String(o[n + ""])).join();
for (const extras of [0, 10, 40, 70]) for (const reversed of [false, true]) for (const victim of [1, 4]) {
  const proto = { a: "A", b: "B", c: "C", d: "D", e: "E" };
  for (let i = 0; i < extras; i++) proto["extra" + i] = i;
  if (reversed) { const ks = Object.keys(proto), vs = ks.map(k => proto[k]); for (const k of ks) delete proto[k]; for (let i = ks.length - 1; i >= 0; i--) proto[ks[i]] = vs[i]; }
  const heir = Object.create(proto), heirOfHeir = Object.create(heir);
  let line = extras + " " + reversed + " " + names[victim] + ": " + all(heir) + " ; " + all(heir);
  remove[victim](proto); line += " ; deleted " + all(heir);
  write[victim](proto, "again"); line += " ; stored " + all(heir) + " ; " + all(heirOfHeir) + " ; own " + all(proto);
  console.log(line);
}
