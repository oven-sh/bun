"use strict";
let hits = 0, last = null; const keys = [Symbol.hasInstance, "other"].slice(0); const BASE = Map;
function Other() {} Object.defineProperty(Other, Symbol.hasInstance, { value: function(x) { hits++; if (x && typeof x === "object" && "x" in x) x.x = 50; return hits % 2 === 0; } });
function keep(c) { Object.defineProperty(c, Symbol.hasInstance, { configurable: true, value: function(x) { hits++; if (x && typeof x === "object" && "x" in x) x.x = 50; return hits % 2 === 0; } }); }
class B0 extends Map { m() { return 1; } }
class E extends Map { static [keys[0]](x) { hits++; if (x && typeof x === "object" && "x" in x) x.x = 50; return hits % 2 === 0; } n() { return 2; } } class D extends E { o() { return 3; } }
function change() { try { 0; return "done"; } catch (e) { return e.constructor.name; } }
const made = []; for (let i = 0; i < 9; i++) { try { made.push(i % 3 === 0 ? new E([[i, 1]]) : i % 3 === 1 ? new Map() : { x: i, y: 1 }); } catch (e) { made.push(null); } }
const points = []; for (let i = 0; i < 8; i++) points.push({ x: i, y: i & 1 ? "t" : i, z: null });
function records(n, at) { let s = 0; const r = []; for (let i = 0; i < n; i++) { const p = points[i & 7]; last = p; const before = p.x; if (i === at) r.push(change()); let x; try { x = p instanceof E; } catch (e) { x = e.constructor.name; } s += p.x - before; let w; try { w = p instanceof D; } catch (e) { w = e.constructor.name; } s += p.x; if (typeof p.y === "number") s += p.y; r.push(x, w, p.z, Object.keys(p).length); p.z = i; } return s + r.join(); }
function objects(list) { const r = []; for (let i = 0; i < list.length; i++) { const p = list[i]; try { if (p instanceof E) r.push("y", typeof p.n); else if (p instanceof D) r.push("d"); else r.push("n", p === null ? 0 : typeof p.x); } catch (e) { r.push(e.constructor.name); } } return r.join(); }
function caught(n) { const r = []; for (let i = 0; i < n; i++) { try { throw made[i % 9]; } catch (e) { let x; try { x = e instanceof E; } catch (g) { x = g.constructor.name; } r.push(x, e instanceof Error); } } return r.join(); }
console.log(records(9, -1)); console.log(objects(made)); console.log(caught(9)); console.log(hits);
console.log(records(17, 8)); console.log(objects(made)); console.log(caught(9)); console.log(made.map(p => { try { return p instanceof E ? 1 : 0; } catch (e) { return "!"; } }).join("")); console.log(hits, E.name, typeof E.prototype);
