// 300 sets of ten undeclared keys come in turn, each twice, then all again: the tables that remember them grow and are emptied while they are in use.
const host: any = globalThis;
const collect: () => void = host.Bun ? () => host.Bun.gc(true) : host.gc;
let serial = 0;
function longText(): string {
  return '"text number ' + ++serial + ' is too long for a cache of short strings"';
}
function freshValue(at: number): string {
  switch (at % 4) {
    case 0:
      return longText();
    case 1:
      return '{"a":' + longText() + ',"b":[' + longText() + "]}";
    case 2:
      return "[" + longText() + "," + ++serial + "]";
    default:
      return longText();
  }
}

type Item = { id: number; name: string };
const texts: string[] = [];
for (let set = 0; set < 300; set++) {
  const members = ['"id":' + set];
  for (let at = 0; at < 10; at++) members.push('"s' + (set * 7 + at * 13) % 601 + "x" + at + '":' + freshValue(at + set));
  members.push('"name":' + longText());
  texts.push("{" + members.join(",") + "}");
}
const kept: Item[] = [];
for (let pass = 0; pass < 3; pass++) {
  let different = 0;
  for (let set = 0; set < texts.length; set++) {
    for (let twice = 0; twice < 2; twice++) {
      const value = JSON.parse<Item>(texts[set]);
      if (value.id !== set || JSON.stringify(value) !== texts[set]) different++;
      if (pass === 0 && twice === 0) kept.push(value);
    }
  }
  for (let set = 0; set < texts.length; set++) if (JSON.stringify(kept[set]) !== texts[set]) different++;
  console.log("pass " + pass + ": " + different + " differ");
}
