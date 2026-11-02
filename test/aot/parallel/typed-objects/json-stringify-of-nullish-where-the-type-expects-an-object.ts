// The type says an object, and null and undefined come through code that nobody follows. The arms for them are unlikely, and still have to write what plain Bun writes.
type Rec = { id: number; name: string; next: Rec; tags: string[] };
const hide = new Function("value", "return value" + (process.argv.length > 1000 ? ";" : ""));
function root(o: Rec) {
  return JSON.stringify(o);
}
function inList(list: Rec[]) {
  return JSON.stringify(list);
}
const record = { id: 1, name: "a", next: hide(null), tags: hide(undefined) } as Rec;
const records = [record, hide(null), hide(undefined), { id: 2, name: "b", next: record, tags: ["x"] } as Rec] as Rec[];
for (let turn = 0; turn < 3; turn++) {
  for (const value of [record, hide(null), hide(undefined), hide(1), hide("text"), hide([]), records[3]]) {
    console.log(String(root(value)));
  }
  console.log(inList(records));
}
