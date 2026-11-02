// `{ ...source, session, id }` where the type of the source is a type variable: the object is born as a copy of the source. With a layout of the two written names it kept the copied names beside its
// fields: two objects for one literal, and the typed form was slower than the untyped one.
const stamp = <T extends object>(source: T, session: string, id: number): T & { session: string; id: number } => ({ ...source, session, id });
const events: object[] = [
  { type: "start", index: 0 },
  { type: "delta", index: 1, text: "x" },
  { type: "delta", index: 2, text: "y", more: true },
  { type: "stop", index: 3 },
  JSON.parse('{"type":"usage","input":1,"output":2}'),
  JSON.parse('{"type":"ping"}'),
];
let sum = 0;
for (let i = 0; i < 300000; i++) {
  const made = stamp(events[i % 6]!, "s", i);
  sum = (sum + made.id + made.session.length + Object.keys(made).length) | 0;
}
console.log(sum);
