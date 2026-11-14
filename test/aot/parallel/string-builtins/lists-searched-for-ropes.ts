// Lists searched for strings of every make: ropes, pieces, wide strings and flat ones among elements of every make, in empty lists and behind other values.
function Holder(this: any) { this.list = []; }
Holder.prototype.places = function (x: any) { return this.list.indexOf(x) + (this.list.includes(x) ? "+" : "-"); };
const quote = process.argv.length > 99 ? "'" : '"';
const base = "abcabdbabc";
const makers: ((word: string) => any)[] = [
  word => word,
  word => quote + word,
  word => quote + word + quote,
  word => word + quote + word,
  word => ("xx" + word + "yy").slice(2, 2 + word.length),
  word => (quote + base + word).slice(1, 1 + word.length),
  word => "日" + word,
  word => (quote + "日" + word).slice(1),
  word => word.slice(0, 0),
  word => word.length,
  word => [word, quote].join("-"),
  word => (word + quote).toUpperCase(),
];
const words = ["abc", "abd", "b", "abc-", '"abc'];
const lines: string[] = [];
for (let element = 0; element < makers.length; element++) {
  for (let sought = 0; sought < makers.length; sought++) {
    const holder = new (Holder as any)();
    let line = element + " " + sought + ":";
    for (let round = 0; round < 4; round++) {
      for (const word of words) line += " " + holder.places(makers[sought]!(word));
      const same = makers[sought]!(words[round]!);
      if (round > 1) holder.list.push(same, undefined, null, { word: same });
      line += " " + holder.places(same);
      holder.list.push(makers[element]!(words[round]!));
      line += " " + holder.places(makers[element]!(words[round]!));
    }
    holder.list.length = 0;
    line += " " + holder.places(makers[sought]!("abc"));
    lines.push(line);
  }
}
console.log(lines.join("\n"));
