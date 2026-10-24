declare const console: { log(...values: unknown[]): void };
let depth = 0;
function has(list: string[], text: string): boolean { if (depth > 0) { depth--; has(list, text); } return list.includes(text); }
function where(list: string[], text: string): number { if (depth > 0) { depth--; where(list, text); } return list.indexOf(text); }
function glue(a: string, b: string | number): string { return a + b; }
const ropes: string[] = []; for (let i = 0; i < 40; i++) ropes.push(glue("name-of-item-", i * 37));
const mixed: string[] = ["plain", glue("pla", "in"), glue("longer-than-", "thirteen"), "", glue("", ""), glue("é", "tude-with-accents"), glue("snow", "☃-man-in-utf-16")];
const needles = ["plain", "name-of-item-0", "name-of-item-37", "name-of-item-1443", "name-of-item-1444", glue("name-of-item-", 74), glue("name-of-", "item-111"), "", "longer-than-thirteen", "longer-than-thirteeN", "étude-with-accents", "snow☃-man-in-utf-16", "snow☃-man-in-utf-17", "nothing", glue("no", "thing")];
for (let round = 0; round < 3; round++) {
    const row: (boolean | number)[] = [];
    for (const needle of needles) row.push(has(ropes, needle), where(ropes, needle), has(mixed, needle), where(mixed, needle));
    console.log(row.join(" "));
}
const fresh: string[] = []; for (let i = 0; i < 1000; i++) fresh.push(glue("s", i & 7));
let count = 0; for (let round = 0; round < 50; round++) { if (has(fresh, "nothing")) count++; if (has(fresh, glue("s", round & 15))) count += 2; count += where(fresh, "s7"); }
console.log(count);
