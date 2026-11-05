const show = (label, made) => console.log(label, Object.keys(made).join(), JSON.stringify(made), "added" in made, Object.entries(made).length);
function a() { const made = { count: 1, label: "two" }; const again = [...new Set([made])][0]; Object.assign(again, { added: 2 }); show("a Set, spread, Object.assign", made); }
function b() { const made = { count: 1, label: "two" }; const again = [...new Set([made])][0]; again.added = 2; show("b Set, spread, a store", made); }
function c() { const made = { count: 1, label: "two" }; const again = [made][0]; Object.assign(again, { added: 2 }); show("c an array, Object.assign", made); }
function d() { const made = { count: 1, label: "two" }; Object.assign(made, { added: 2 }); show("d its own name, Object.assign", made); }
function e() { const made = { count: 1, label: "two" }; const again = new Map([["k", made]]).get("k"); Object.assign(again, { added: 2 }); show("e a Map, Object.assign", made); }
function f() { const made = { count: 1, label: "two" }; const again = [...new Set([made])][0]; Object.defineProperty(again, "added", { value: 2, enumerable: true }); show("f Set, spread, defineProperty", made); }
function g() { const made = { count: 1, label: "two" }; const again = Array.from(new Set([made]))[0]; Object.assign(again, { added: 2 }); show("g Array.from of a Set", made); }
function h() { const made = { count: 1, label: "two" }; const again = [...new Set([made])][0]; delete again.label; show("h Set, spread, delete", made); }
for (const each of [a, b, c, d, e, f, g, h]) each();
