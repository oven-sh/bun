// A chain of array methods that ends in a tail call.
declare const console: { log(...values: any[]): void };

function hasLongPartBehindTheFirst(text: string): boolean {
  return text
    .replace(/a/g, "b")
    .split("|")
    .slice(1)
    .some(part => part.length > 2);
}

function hasLongPart(text: string): boolean {
  return text
    .split("|")
    .slice(0)
    .some(part => part.length > 2);
}

for (const text of ["one|x", "x|two", "x|aa", "x|aaa", ""]) {
  console.log(JSON.stringify(text), hasLongPartBehindTheFirst(text), hasLongPart(text));
}
