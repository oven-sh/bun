// Built-in functions write names that they choose themselves, `stack`, `length`, `lastIndex` and an index, to the prototype object that they are handed. The objects below declare fields of those names and leave them empty.
class Entry {
  a: number;
  declare stack?: number;
  declare length?: string;
  declare lastIndex?: string;
  constructor(a: number) {
    this.a = a;
  }
}
const entries: Entry[] = [];
for (let a = 0; a < 8; a++) {
  const entry = new Entry(a);
  if (a === 0) {
    entry.stack = 1;
    entry.length = "own";
    entry.lastIndex = "own";
  }
  entries.push(entry);
}
function round(label: string) {
  let text = "";
  for (const entry of entries) text += `${typeof entry.stack}${"stack" in entry ? "+" : "-"}${entry.length}${"length" in entry ? "+" : "-"}${entry.lastIndex}${"lastIndex" in entry ? "+" : "-"} `;
  console.log(label, text);
}
round("before");
(Error as any).captureStackTrace(Entry.prototype);
round("Error.captureStackTrace");
Array.prototype.push.call(Entry.prototype, "pushed");
round("Array.prototype.push");
const prototype = Entry.prototype as any;
prototype.flags = "g";
prototype.exec = () => null;
(RegExp.prototype as any)[Symbol.replace].call(prototype, "text", "");
round("RegExp.prototype[Symbol.replace]");
