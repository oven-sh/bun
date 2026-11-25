const unseen = (x) => [x][JSON.parse("0")];
class Crate { constructor(id) { this.id = id; } size() { return 1; } }
class Box { constructor(id) { this.label = "box"; this.id = id; } }
class Bag { constructor(id) { this.id = id; this.label = "bag"; } }
class Jar { constructor(id) { this.id = id; this.lid = 1; this.label = "jar"; } }
class Tin { constructor(id) { this.id = id; this.lid = 1; this.rim = 2; this.label = "tin"; } }
class Keg { constructor(id) { this.id = id; this.lid = 1; this.rim = 2; this.tap = 3; this.label = "keg"; } }
class Vat { constructor(id) { this.id = id; this.lid = 1; this.rim = 2; this.tap = 3; this.foot = 4; this.label = "vat"; } }
const makers = [Crate, Box, Crate, Bag, Crate, Jar, Crate, Tin, Crate, Keg, Crate, Vat];
function put(o, v) { "use strict"; let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; o.label = v; return w; }
function look(o) { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; return String(o.label) + w; }
const name = JSON.parse('"label"');
const out = [];
let seen = 0;
function turn(i) {
  let w = 0; for (let k = 0; k < 2; k++) w = (w + k) | 0;
  const o = unseen(new makers[i % makers.length](i));
  if (i === 601) Object.defineProperty(Crate.prototype, name, { set(v) { seen += 1; }, get() { return "above"; }, configurable: true });
  if (i === 801) delete Crate.prototype[name];
  if (i === 901) Object.defineProperty(Crate.prototype, name, { value: "fixed", writable: false, configurable: true });
  let said = "ok";
  try { put(o, i); } catch (e) { said = e.name; }
  if ((i >= 598 && i <= 604) || (i >= 798 && i <= 804) || (i >= 898 && i <= 904)) out.push([i, said, Object.keys(o).join("+"), look(o), JSON.stringify(o), seen].join("|"));
}
for (let i = 0; i < 1000; i++) turn(i);
console.log(out.join("\n"));
