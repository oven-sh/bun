"use strict";
// Loops over arrays in captured variables that are read in their dead zones in some calls.
const lines = [];
function row(name, make) {
  const out = [];
  for (let r = 0; r < 9; r++) {
    let said;
    try { said = make(r & 3); } catch (e) { said = e.constructor.name; }
    out.push(String(said));
  }
  lines.push(name + " " + out.join(" "));
}
function declaredLate(n) { function total(n) { let s = 0; for (let i = 0; i < n; i++) s += list[i]; return s; } let said; try { said = total(n); } catch (e) { said = e.constructor.name; } let list = [1, 2, 3]; return said + ":" + total(3); }
function assignedLate(n) { for (let z = 0; z < 2; z++) { function total(n) { let s = 0; for (let i = 0; i < n; i++) { s++; s += list[i]; } return s; } let said; try { said = total(n); } catch (e) { said = e.constructor.name; } let list; list = [1, 2, 3]; return said + ":" + total(3); } }
function constant(n) { function total(n) { let s = 0, i = 0; while (i < n) { if (list[i]) s++; i++; } return s; } let said = "none"; if (n === 2) try { said = total(n); } catch (e) { said = e.name; } const list = [true, false, true]; return said + ":" + total(3); }
function nested(n) { function total(n) { let s = 0; for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) s += list[i] * list[j]; return s; } let said; try { said = total(n); } catch (e) { said = e.constructor.name; } const list = [1.5, 2.5, 3.5]; return said + ":" + total(3); }
function rows(n) { function total(n) { let s = 0; for (let i = 0; i < n; i++) s += list[i % 3][0]; return s; } let said; try { said = total(n); } catch (e) { said = e.constructor.name; } let list; list = [[1, 2], [3, 4], [5, 6]]; return said + ":" + total(3); }
function stores(n) { function total(n) { let s = 0; for (let i = 0; i < n; i++) { list[i] = list[i] + 1; s += list[i]; } return s; } let said; try { said = total(n); } catch (e) { said = e.constructor.name; } let list = [1, 2, 3]; return said + ":" + total(3) + ":" + total(2); }
function* generator(n) { function total(n) { let s = 0; for (let i = 0; i < n; i++) s += list[i]; return s; } let said; try { said = total(n); } catch (e) { said = e.constructor.name; } yield said; const list = [1, 2, 3]; yield total(3); }
row("let", r => declaredLate(r));
row("let without a value", r => assignedLate(r));
row("const", r => constant(r));
row("nested", r => nested(r));
row("rows", r => rows(r));
row("stores", r => stores(r));
row("generator", r => [...generator(r)].join(":"));
function step(r) { return declaredLate(r & 3); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); lines.push(out.join(" "));
function stepAssigned(r) { return assignedLate(r & 3); }
const assigned = []; for (let r = 0; r < 12; r++) assigned.push(String(stepAssigned(r))); lines.push(assigned.join(" "));
function stepConstant(r) { return constant(r & 3); }
const constants = []; for (let r = 0; r < 12; r++) constants.push(String(stepConstant(r))); lines.push(constants.join(" "));
function stepNested(r) { return nested(r & 3); }
const nests = []; for (let r = 0; r < 12; r++) nests.push(String(stepNested(r))); lines.push(nests.join(" "));
function stepRows(r) { return rows(r & 3); }
const rowsSaid = []; for (let r = 0; r < 12; r++) rowsSaid.push(String(stepRows(r))); lines.push(rowsSaid.join(" "));
function stepStores(r) { return stores(r & 3); }
const stored = []; for (let r = 0; r < 12; r++) stored.push(String(stepStores(r))); lines.push(stored.join(" "));
console.log(lines.join("\n"));
