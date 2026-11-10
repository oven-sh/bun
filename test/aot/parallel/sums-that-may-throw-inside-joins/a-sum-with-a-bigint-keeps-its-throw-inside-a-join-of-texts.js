function inFront(v) { return "value: " + (v + 1n); }
function behind(v) { return (v + 1n) + " is the value"; }
function grown(v) { let s = "value: "; s += v + 1n; return s; }
function template(v) { return `value: ${v + 1n}!`; }
function throughConst(v) { const sum = v + 1n; return "value: " + sum; }
function made(v) { return "value: " + (v + BigInt(3)); }
function onTheLeft(v) { return "value: " + (1n + v); }
const record = { step: 2n };
function field(v) { return "value: " + (v + record.step); }
function chosen(v, first) { return "value: " + ((first ? v : "b") + 1n); }
const said = [];
for (const v of ["a", 0]) { try { said.push(inFront(v)); } catch (e) { said.push(e.name); } }
for (const v of ["a", 0]) { try { said.push(behind(v)); } catch (e) { said.push(e.name); } }
for (const v of ["a", 0]) { try { said.push(grown(v)); } catch (e) { said.push(e.name); } }
for (const v of ["a", 0]) { try { said.push(template(v)); } catch (e) { said.push(e.name); } }
for (const v of ["a", 0]) { try { said.push(throughConst(v)); } catch (e) { said.push(e.name); } }
for (const v of ["a", 1.5]) { try { said.push(made(v)); } catch (e) { said.push(e.name); } }
for (const v of ["a", true]) { try { said.push(onTheLeft(v)); } catch (e) { said.push(e.name); } }
for (const v of ["a", null, undefined]) { try { said.push(field(v)); } catch (e) { said.push(e.name); } }
for (const v of ["a", 0]) { try { said.push(chosen(v, true), chosen(v, false)); } catch (e) { said.push(e.name); } }
console.log(said.join(" | "));
