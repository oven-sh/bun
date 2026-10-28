// Built ins assorted: from entries. It prints what plain Bun prints.
const pairs: [string, number][] = [["first", 1]];
console.log(JSON.stringify(Object.fromEntries(pairs)));
