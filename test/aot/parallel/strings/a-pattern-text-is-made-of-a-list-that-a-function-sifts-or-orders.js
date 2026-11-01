// The text of a pattern is joined from a list of texts that the program first sifts or puts in order with a function of its own: the longest first, so that the longer alternative wins, is the
// usual reason. The list and the function are written in the program, so the build calls the function on the members itself, works the text out, and the pattern has its code.
// COUNTER: RegExpsCreatedWithoutRecord = 0
// COUNTER: RegExpsCompiledToBytecode = 0
// COUNTER: RegExpMatchesInterpreted = 0
const words = ["in", "instanceof", "int", "interface", "is", "import"];
const isLong = word => word.length > 3;
const made = [
  new RegExp("^(?:" + [...words].sort((first, second) => second.length - first.length).join("|") + ")"),
  new RegExp("^(?:" + words.toSorted((first, second) => first.length - second.length).join("|") + ")$"),
  new RegExp(words.filter(word => word.length > 2).join("|")),
  new RegExp(words.filter(isLong).join("-")),
  new RegExp(words.filter(word => word !== "int").join("|")),
  new RegExp(words.filter(isLong).sort((first, second) => first.length - second.length).join("|") + "$"),
  new RegExp(words.filter(isLong).map(word => word + "\\b").join("|")),
];
console.log(made.map(each => each.source).join(" "));
console.log(made.map(each => String(each.exec("interface in int")?.[0])).join(" "));
