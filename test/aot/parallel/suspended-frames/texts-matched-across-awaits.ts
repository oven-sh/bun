// One text is matched several times in a loop, on both sides of an await. Meanwhile other code makes the text a key.
const names: Record<string, number> = {};
let current = "";
async function store(): Promise<void> {
  const keys: Record<string, number> = {};
  keys[current] = 1;
  await null;
  Bun.gc(true);
}
async function count(text: string, turns: number): Promise<number> {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const a = /^(a)b/.exec(text);
    if (a) sum += a[1]!.length;
    const b = /^(a)(b)c/.exec(text);
    if (b) sum += 100 * b[2]!.length;
    current = text;
    await store();
    const c = /^(ab)cd/.exec(text);
    if (c) sum += 10000 * c[1]!.length;
    const d = /^(abc)de/.exec(text);
    if (d) sum += 1000000 * d[1]!.length;
  }
  return sum;
}
async function words(text: string): Promise<string> {
  const found: string[] = [];
  const letters = /[a-z]+/y, digits = /[0-9]+/y, others = /[^a-z0-9]+/y;
  let place = 0;
  while (place < text.length) {
    letters.lastIndex = place;
    const letter = letters.exec(text);
    if (letter) { found.push(letter[0]!); place = letters.lastIndex; current = text; await store(); continue; }
    digits.lastIndex = place;
    const digit = digits.exec(text);
    if (digit) { found.push(digit[0]!); place = digits.lastIndex; continue; }
    others.lastIndex = place;
    const other = others.exec(text);
    if (other) { place = others.lastIndex; await store(); }
  }
  return found.join();
}
for (let turn = 0; turn < 4; turn++) {
  const whole = (): string => ["abcdefgh", turn, "ijklmnop".repeat(8)].join("-");
  const part = (): string => ["####abcdefgh", turn, "ijklmnop".repeat(8), "####"].join("-").slice(4, 70);
  names[whole()] = 0;
  names[part()] = 0;
  console.log(await count(whole(), 3), await count(part(), 3), await words(whole()), await words(part()));
}
