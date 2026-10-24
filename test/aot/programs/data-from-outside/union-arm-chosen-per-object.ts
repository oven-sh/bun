// Objects from JSON.parse with the same property names, one of which the types do not declare, enter a union of record types. Which
// arm an object belongs to depends on a tag and, for one tag, on the type of a value: the choice made for one object must not be
// taken for the next without looking.
type In = { r: number };
type At = { p: number; q: In };
type Count = { kind: "x"; v: number; at: At };
type Label = { kind: string; v: string; at: At };
type Other = { kind: "y"; v: number; at: At; w?: number };
type Any3 = Count | Label | Other;
const made: Any3[] = [{ kind: "x", v: 1, at: { p: 1, q: { r: 1 } } }, { kind: "z", v: "s", at: { p: 2, q: { r: 2 } } }, { kind: "y", v: 2, at: { p: 3, q: { r: 3 } }, w: 4 }];
function show(m: Any3): string {
  m.at.q.r += 1;
  return m.kind + ":" + typeof m.v + ":" + m.v + ":" + m.at.q.r;
}
const texts = ['{"kind":"x","v":1,"more":true,"at":{"p":1,"q":{"r":1}}}', '{"kind":"x","v":"one","more":true,"at":{"p":1,"q":{"r":2}}}', '{"kind":"y","v":3,"more":true,"at":{"p":1,"q":{"r":3}}}', '{"kind":"w","v":"four","more":true,"at":{"p":1,"q":{"r":4}}}'];
const out: string[] = made.map(show);
const kept: any[] = [];
for (let turn = 0; turn < 3; turn++) {
  for (const text of texts) {
    const raw: any = JSON.parse(text);
    kept.push(raw);
    out.push(show(raw) + ":" + raw.more + ":" + raw.at.q.r + ":" + Object.keys(raw).join());
  }
}
console.log(out.join("\n"));
console.log(kept.length, kept.every(raw => raw.more === true));
