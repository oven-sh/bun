const places = JSON.parse("[1,2,3]");
function make() { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; const v = new Int32Array(8); v[1] = 7; v[2] = 8; v[3] = 9; return v; }
function makeOther() { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; const v = new Int32Array(8); v[1] = 7; v[2] = 8; v[3] = 9; return v; }
function giveAway(v) { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; v.buffer.transfer(); return w; }
const rows = {
  twin() { const v = makeOther(), a = v[places[0] & 7]; const b = v[places[1] & 7]; v[places[2] & 7] = 5; return [a, b, v[places[2] & 7], v.length]; },
  inLine() { const v = make(), a = v[places[0] & 7]; v.buffer.transfer(); const b = v[places[1] & 7]; v[places[2] & 7] = 5; return [a, b, v[places[2] & 7], v.length]; },
  callee() { const v = make(), a = v[places[0] & 7]; giveAway(v); const b = v[places[1] & 7]; v[places[2] & 7] = 5; return [a, b, v[places[2] & 7], v.length]; },
  getter() { const v = make(), o = { get g() { return giveAway(v); } }, a = v[places[0] & 7]; o.g; const b = v[places[1] & 7]; v[places[2] & 7] = 5; return [a, b, v[places[2] & 7], v.length]; },
  index() { const v = make(), a = v[places[0] & 7], k = { valueOf() { giveAway(v); return 2; } } & 7; const b = v[k]; v[places[2] & 7] = 5; return [a, b, v[places[2] & 7], v.length]; },
  stored() { const v = make(), a = v[places[0] & 7]; v[places[2] & 7] = { valueOf() { giveAway(v); return 5; } }; const b = v[places[1] & 7]; return [a, b, v[places[2] & 7], v.length]; },
  each() { const v = make(), a = v[places[0] & 7]; [0].forEach(() => giveAway(v)); const b = v[places[1] & 7]; v[places[2] & 7] = 5; return [a, b, v[places[2] & 7], v.length]; },
  cloned() { const v = make(), a = v[places[0] & 7]; structuredClone(0, { transfer: [v.buffer] }); const b = v[places[1] & 7]; v[places[2] & 7] = 5; return [a, b, v[places[2] & 7], v.length]; },
  handler() { const v = make(); let a, b; try { a = v[places[0] & 7]; giveAway(v); throw 0; } catch { b = v[places[1] & 7]; } v[places[2] & 7] = 5; return [a, b, v[places[2] & 7], v.length]; },
  backEdge() { const v = make(), out = []; for (let t = 0; t < 2; t++) { out.push(v[places[t] & 7]); if (!t) giveAway(v); } v[places[2] & 7] = 5; return [...out, v[places[2] & 7], v.length]; },
  async awaited() { const v = make(), a = v[places[0] & 7]; await Promise.resolve().then(() => giveAway(v)); const b = v[places[1] & 7]; v[places[2] & 7] = 5; return [a, b, v[places[2] & 7], v.length]; },
  yielded() { const v = make(); function* g() { const a = v[places[0] & 7]; yield; const b = v[places[1] & 7]; v[places[2] & 7] = 5; return [a, b, v[places[2] & 7], v.length]; } const it = g(); it.next(); giveAway(v); return it.next().value; },
  other() { const v = make(), u = make(), a = v[places[0] & 7]; giveAway(u); const b = u[places[1] & 7]; u[places[2] & 7] = 5; return [a, b, u[places[2] & 7], u.length]; },
};
for (const name in rows) { let said; try { said = (await rows[name]()).map(String).join(); } catch (e) { said = "threw " + e.constructor.name; } console.log("SAID " + name + " " + said); }
