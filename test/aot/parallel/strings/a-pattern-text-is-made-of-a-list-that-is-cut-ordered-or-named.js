// The text of a pattern is joined from a list of texts that the program has first cut, turned round, put in order or read off the names of an object, or is made from the numbers of its
// characters. All of it hangs on what is written in the program alone, so the build works the text out and the pattern has its code.
// COUNTER: RegExpsCreatedWithoutRecord = 0
// COUNTER: RegExpsCompiledToBytecode = 0
// COUNTER: RegExpMatchesInterpreted = 0
const words = ["delta", "alpha", "gamma", "beta", "epsilon"];
const table = { red: 1, green: 2, blue: 3 };
const made = [
  new RegExp(words.slice(1, 3).join("|")),
  new RegExp("^" + words.at(-1) + "+$"),
  new RegExp([...words].reverse().join("|")),
  new RegExp([...words].sort().join("|")),
  new RegExp(words.toSorted().join("-")),
  new RegExp(words.toReversed().slice(0, 2).join("|")),
  new RegExp(words.concat(["zeta", "eta"]).join("|")),
  new RegExp(words.with(0, "omega").join("|")),
  new RegExp(`\\b(${Object.keys(table).join("|")})\\b`, "g"),
  new RegExp(Object.keys({ left: true, right: false }).join("|")),
  new RegExp(String.fromCharCode(97, 43, 98)),
  new RegExp(String.fromCodePoint(0x61, 0x2a) + "c"),
  new RegExp("x{" + words.indexOf("gamma") + "}" + (words.includes("beta") ? "y" : "z")),
];
console.log(made.map(each => each.source).join(" "));
console.log(made.map(each => (each.test("alpha gamma red left aab xxy epsilon") ? 1 : 0)).join(""));
