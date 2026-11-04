// `label` stores a name that no type of the entries lists, under a key that only the run knows, so it lies beside the fields. `unlabeled` leaves it out again: what comes back has the names, the order and the type of the entry.
interface Note {
  kind: "note";
  text: string;
  more?: number;
}
interface Task {
  kind: "task";
  name: string;
  input: { path: string };
}
type Entry = Note | Task;
const key = ["label", "id"].join("_");
function label<T extends object>(entry: T, id: string): T & { label_id?: string } {
  (entry as Record<string, unknown>)[key] = id;
  return entry;
}
function unlabeled<T extends { label_id?: string }>(entry: T) {
  const { label_id: _id, ...rest } = entry;
  return rest;
}
function describe(entry: Entry): string {
  return entry.kind === "note" ? entry.text + (entry.more ?? "") : entry.name + entry.input.path;
}
function show(value: object): string {
  return JSON.stringify(value) + " " + Reflect.ownKeys(value).map(String).join() + " " + ("label_id" in value);
}
const mark = Symbol("mark");
const out: string[] = [];
for (let turn = 0; turn < 4; turn++) {
  const note: Note = turn & 1 ? { kind: "note", text: "t" + turn, more: turn } : { kind: "note", text: "t" + turn };
  const task: Task = { kind: "task", name: "n" + turn, input: { path: "/p" + turn } };
  for (const entry of [note, task] as Entry[]) {
    const labeled = label(entry, "s" + turn);
    const back = unlabeled(labeled) as Entry;
    out.push(show(labeled) + " | " + show(back) + " | " + describe(back) + " | " + (back !== entry));
    // Two names beside the fields, one of them left out. A symbol beside them stays.
    (labeled as Record<string, unknown>)["late" + (turn & 1)] = turn;
    (labeled as Record<symbol, unknown>)[mark] = turn;
    const again = unlabeled(labeled);
    out.push(show(again) + " | " + describe(again as Entry));
    // The copy takes the name anew, behind all the others, and the entry keeps its own.
    (again as Record<string, unknown>).label_id = "anew";
    out.push(show(again) + " | " + show(labeled));
    out.push(show(unlabeled(Object.freeze(label({ ...entry }, "frozen")))) + " " + Object.isFrozen(unlabeled(Object.freeze({ ...entry }))));
  }
}
let sum = 0;
for (let turn = 0; turn < 30000; turn++) {
  const entry: Entry = turn & 1 ? { kind: "note", text: "t" } : { kind: "task", name: "n", input: { path: "/" } };
  sum += describe(unlabeled(label(entry, "s")) as Entry).length;
}
out.push(String(sum));
console.log(out.join("\n"));
