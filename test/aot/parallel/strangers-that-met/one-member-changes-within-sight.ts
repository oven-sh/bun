type Part = { id: number; note?: string };
const p0 = { id: 0, a: 1 };
const p1 = { id: 1, b: 1 };
const p2 = { id: 2, c: 1, note: "two" };
const p3 = { d: 1, id: 3 };
const p4 = { id: 4, e: 1 };
const parts: Part[] = [p0, p1, p2, p3, p4];
function sum(list: Part[]): string {
  let total = 0, notes = "";
  for (const part of list) { total += part.id; if (part.note !== undefined) notes += part.note; }
  return total + notes;
}
let text = sum(parts);
(p1 as Part).note = "one";
text += " " + sum(parts);
delete (p2 as Part).note;
text += " " + sum(parts);
(p3 as { id: number }).id = 30;
text += " " + sum(parts);
console.log(text);
