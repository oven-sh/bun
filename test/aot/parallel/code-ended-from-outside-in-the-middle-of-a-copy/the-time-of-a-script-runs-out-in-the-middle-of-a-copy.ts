// A script of node:vm calls a function of the program that copies records without end, and its time runs out, sixty times over. The record holds a name beside its fields, under a key that only the run knows, and the copy leaves that name out. The thread goes on behind each end.
import { runInNewContext } from "node:vm";
interface Note {
  kind: "note";
  text: string;
}
const key: string = JSON.parse('"label_id"');
function label<T extends object>(entry: T, id: string): T & { label_id?: string } {
  (entry as Record<string, unknown>)[key] = id;
  return entry;
}
let sum = 0;
const ring: unknown[] = [0, 0, 0, 0];
let kept = 0;
function keep<T>(value: T): T {
  ring[kept++ & 3] = value;
  return value;
}
function unlabeled<T extends { label_id?: string }>(entry: T) {
  const { label_id: _id, ...rest } = entry;
  return rest;
}
function deeds(): void {
  for (;;) {
    const entry: Note = { kind: "note", text: "t" };
    sum += (keep(unlabeled(label(entry, "s"))) as Note).text.length;
  }
}
const codes = new Map<string, number>();
for (let round = 0; round < 60; round++) {
  try {
    runInNewContext("deeds()", { deeds }, { timeout: 1 + (round % 3) });
  } catch (error) {
    const code = String((error as { code?: string }).code);
    codes.set(code, (codes.get(code) ?? 0) + 1);
  }
}
console.log([...codes].join(), JSON.stringify(unlabeled(label({ kind: "note", text: "t" }, "s"))), sum > 0);
