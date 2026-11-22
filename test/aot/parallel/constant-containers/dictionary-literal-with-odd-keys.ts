// Names that look like numbers, indexes, an own `__proto__`, the empty name and names of Object.prototype in a literal whose type names no keys.
const table: Record<string, string | number | null | undefined | boolean> = {
  "-1": "minus", "+1": "plus", "100": "hundred", "1234": "digits", 5: "five", 1.5: "half", "007": "bond", "4294967295": "big", "4294967294": "max index",
  plain: "p", "with space": 1, "ünï": 2.5, dup: "first", other: null, nothing: undefined, yes: true, ["__proto__"]: "own", "": "empty", "constructor": "c", "toString": "t",
};
function find(key: string) { return table[key]; }
console.log(JSON.stringify(Object.keys(table)), JSON.stringify(table), find(process.argv[2] ?? "dup"), Object.getPrototypeOf(table) === Object.prototype);
