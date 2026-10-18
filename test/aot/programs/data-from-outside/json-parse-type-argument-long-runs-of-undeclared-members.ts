// Runs of 1 to 130 undeclared members in a row, all with fresh values, in front of, between and behind the declared ones; each text is parsed five times.
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
const kept: { value: Item; text: string }[] = [];
for (const length of [1, 2, 3, 4, 5, 8, 15, 16, 17, 30, 31, 32, 33, 34, 63, 64, 65, 66, 95, 96, 97, 128, 130]) {
  let different = 0;
  for (let place = 0; place < 4; place++) {
    const run: string[] = [];
    for (let at = 0; at < length; at++) run.push('"r' + at + '":' + (place === 3 ? String(at) : freshValue(at)));
    const members = place === 0 ? ['"id":1', '"name":' + longText(), ...run] : place === 1 ? [...run, '"id":1', '"name":' + longText()] : ['"id":1', ...run, '"name":' + longText()];
    const text = "{" + members.join(",") + "}";
    for (let round = 0; round < 5; round++) {
      const value = JSON.parse<Item>(text);
      if (value.id !== 1 || value.name.length < 40 || JSON.stringify(value) !== text) different++;
      if (round === 4) kept.push({ value, text });
    }
  }
  for (const entry of kept) if (JSON.stringify(entry.value) !== entry.text) different++;
  console.log("runs of " + length + ": " + different + " differ");
}
