const tag = (strings: TemplateStringsArray, ..._: unknown[]) => strings;
function made(): any { return tag`a${1}b${2}c`; }
function lengths(list: any): number { let total = 0; for (let i = 0; i < list.length; i++) total += list[i].length; return total; }
function joined(list: any): string { let text = ""; for (const part of list) text += part + "|"; return text; }
let sum = 0; let last = "";
for (let round = 0; round < 3000; round++) {
  const copy = made().concat();
  const more = made().concat(["x", "yy"], made().raw);
  const sliced = made().slice(1);
  const mapped = made().map((part: string) => part + part);
  sum += lengths(copy) + lengths(more) + lengths(sliced) + lengths(mapped);
  last = joined(copy) + joined(more) + joined(sliced) + joined(mapped) + typeof copy[0] + typeof more[4] + Object.isFrozen(copy) + Array.isArray(copy);
}
console.log(sum, last);
const first = made().concat();
first.push(7, { a: 1 }, null);
console.log(JSON.stringify(first), first.length, typeof first[3], first[4].a, first[5]);
