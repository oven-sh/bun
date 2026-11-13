// What a body only asks for tells no class.
// One class of a hierarchy has every name that a function uses, but the function only asks for most of them, and it gets the other classes too.
class Material { constructor(id) { this.opacity = id / 4; this.id = id; } }
class Basic extends Material { constructor(id) { super(id); this.map = id % 2 ? id : null; } }
class Lit extends Basic { constructor(id) { super(id); this.bumpMap = id % 3 ? id : 0; this.emissiveMap = "e" + id; } }
class Full extends Lit { constructor(id) { super(id); this.specularMap = id % 5 ? id : ""; this.lightMap = id / 2; this.ior = 1.5; } }
class Dashed extends Material { constructor(id) { super(id); this.dash = id; } }
const log = [];
const holder = { environment: null };
const out = [];
function refresh(material) {
  out.push(material.opacity);
  if (material.map) out.push('map', material.map);
  if (material.bumpMap) out.push('bumpMap', material.bumpMap);
  if (material.emissiveMap) out.push('emissiveMap', material.emissiveMap);
  if (material.specularMap) out.push('specularMap', material.specularMap);
  if (material.lightMap) out.push('lightMap', material.lightMap);
  if (holder.environment) out.push("ior", material.ior);
  return out.splice(0).join();
}
const table = { refresh };
const name = "kept" + log.length;
globalThis[name] = { Material, Basic, Lit, Full, Dashed, table, log, holder, out };
const kept = globalThis[name];
function show(label, material) {
  let text;
  try { text = kept.table.refresh(material); } catch (error) { text = error.name; out.length = 0; }
  console.log(label, text, log.splice(0).join());
}
[Material, Basic, Lit, Full, Dashed].forEach((of, at) => { show(of.name, new of(at + 1)); show(of.name, new of(at + 6)); });
holder.environment = {};
show("environment", new Full(5));
show("environment", new Lit(5));
holder.environment = null;
{ const full = new Full(5); delete full.bumpMap; show("no map", full); }
{ const basic = new Basic(6); basic.lightMap = 3; show("late", basic); }
{ const basic = new Basic(7); Object.defineProperty(basic, "lightMap", { get() { log.push("lightMap"); return 1; } }); show("accessor", basic); }
{ const dashed = new Dashed(8); Object.setPrototypeOf(dashed, { map: 1, get emissiveMap() { log.push("emissiveMap"); return 0; } }); show("prototype", dashed); }
show("record", { opacity: 1, map: 5, id: 2 });
show("proxy", new Proxy(new Lit(2), { get(target, key) { log.push(String(key)); return target[key]; } }));
show("nothing", undefined);
Material.prototype.specularMap = 4;
show("above", new Dashed(9));
delete Material.prototype.specularMap;
show("end", new Full(10));
