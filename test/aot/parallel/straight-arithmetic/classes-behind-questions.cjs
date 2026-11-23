// What a body only asks for tells no class.
// One class of a hierarchy has every name that a function uses, but the function only asks for most of them, and it gets the other classes too.
class Boat { constructor(id) { this.weight = id / 4; this.id = id; } }
class Sailing extends Boat { constructor(id) { super(id); this.sail = id % 2 ? id : null; } }
class Rigged extends Sailing { constructor(id) { super(id); this.mast = id % 3 ? id : 0; this.flag = "e" + id; } }
class Crewed extends Rigged { constructor(id) { super(id); this.anchor = id % 5 ? id : ""; this.lamp = id / 2; this.crew = 1.5; } }
class Raft extends Boat { constructor(id) { super(id); this.pole = id; } }
const log = [];
const harbor = { storm: null };
const out = [];
function inspect(boat) {
  if (boat.flag) out.push('under ' + boat.flag);
  out.push(boat.weight);
  if (boat.anchor) out.push('anchor', boat.anchor);
  if (boat.sail) out.push('sail', boat.sail);
  if (boat.lamp) out.push('lamp', boat.lamp);
  if (boat.mast) out.push(boat.mast, 'mast');
  if (harbor.storm) out.push(boat.crew, "aboard");
  return out.splice(0).join();
}
const table = { inspect };
const name = "kept" + log.length;
globalThis[name] = { Boat, Sailing, Rigged, Crewed, Raft, table, log, harbor, out };
const kept = globalThis[name];
function show(label, boat) {
  let text;
  try { text = kept.table.inspect(boat); } catch (error) { text = error.name; out.length = 0; }
  console.log(label, text, log.splice(0).join());
}
[Boat, Sailing, Rigged, Crewed, Raft].forEach((of, at) => { show(of.name, new of(at + 1)); show(of.name, new of(at + 6)); });
harbor.storm = {};
show("storm", new Crewed(5));
show("storm", new Rigged(5));
harbor.storm = null;
{ const crewed = new Crewed(5); delete crewed.mast; show("no mast", crewed); }
{ const sailing = new Sailing(6); sailing.lamp = 3; show("late", sailing); }
{ const sailing = new Sailing(7); Object.defineProperty(sailing, "lamp", { get() { log.push("lamp"); return 1; } }); show("accessor", sailing); }
{ const raft = new Raft(8); Object.setPrototypeOf(raft, { sail: 1, get flag() { log.push("flag"); return 0; } }); show("prototype", raft); }
show("record", { weight: 1, sail: 5, id: 2 });
show("proxy", new Proxy(new Rigged(2), { get(target, key) { log.push(String(key)); return target[key]; } }));
show("nothing", undefined);
Boat.prototype.anchor = 4;
show("above", new Raft(9));
delete Boat.prototype.anchor;
show("end", new Crewed(10));
