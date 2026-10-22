// The same names in a literal without a type, one of them twice: it keeps its first place and its last value.
const table = {
  "-1": "minus", "+1": "plus", "100": "hundred", "1234": "digits", 5: "five", 1.5: "half", "007": "bond", "4294967295": "big", "4294967294": "max index",
  plain: "p", "with space": 1, "ünï": 2.5, dup: "first", other: null, dup: "second", nothing: undefined, yes: true, ["__proto__"]: "own", "": "empty", "constructor": "c", "toString": "t",
};
function find(key) { return table[key]; }
console.log(JSON.stringify(Object.keys(table)), JSON.stringify(table), find(process.argv[2] ?? "dup"), Object.getPrototypeOf(table) === Object.prototype);
