// Deleting an optional field from a spread copy leaves it absent in the copy, even where every object of the type is created with the field and no original loses it.
interface Note { id: number; text?: string }
function make(id: number): Note { return { id, text: "note " + id } }
function lengthOf(note: Note): number { return note.text === undefined ? -1 : note.text.length }
const derived = Object.create(make(0));
let total = 0;
for (let i = 0; i < 2000; i++) {
  const copy: Note = { ...make(i) };
  if (i % 2) delete copy.text;
  total += lengthOf(copy) + ("text" in copy ? 1 : 0);
}
console.log(total, derived.id, derived.text);
