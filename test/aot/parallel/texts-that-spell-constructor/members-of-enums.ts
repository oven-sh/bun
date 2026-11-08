enum Kind {
  Maker = "constructor",
  Other = "other",
}
const enum Folded {
  Maker = "constructor",
}
const n = process.argv.length;
console.log(Kind.Maker, Folded.Maker, `${Kind.Maker}${n > 100 ? 1 : ""}`, `${Folded.Maker}!`);
