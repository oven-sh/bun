// A literal with `__proto__` stands below an object with a setter under a key in the middle of the literal: a literal defines its properties, so the setter is never called, whatever the compiler knows of the value.
let calls = 0;
const above = { set tag(v: unknown) { calls++; }, get tag(): unknown { return "above"; } };
function row(a: number | undefined) { return { id: 1, tag: a, more: 2, last: "z" }; }
function rowBelow(a: number | undefined) { return { __proto__: above, id: 1, tag: a, more: 2, last: "z" }; }
function tellOf(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o); }

function deed(o: object): object {
  Object.setPrototypeOf(o, above);
  return o;
}
console.log(tellOf(row(1.5)), tellOf(row(undefined)), tellOf(rowBelow(1.5)), tellOf(rowBelow(undefined)), String(calls));
let sum = 0;
for (let i = 0; i < 200; i++) sum += (row(i % 3 ? i + 0.5 : undefined).tag ?? 1) + (rowBelow(i % 3 ? i + 0.5 : undefined).tag ?? 1);
console.log(String(sum), String(calls));
const moved = deed(row(2.5)) as { tag: unknown };
console.log(tellOf(moved), String(moved.tag), String(Object.prototype.hasOwnProperty.call(rowBelow(undefined), "tag")), String(rowBelow(undefined).tag), String(calls));
delete (moved as { tag?: unknown }).tag;
moved.tag = 9;
console.log(tellOf(moved), String(moved.tag), String(calls));
