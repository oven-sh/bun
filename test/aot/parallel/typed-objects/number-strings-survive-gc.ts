// The engine keeps the strings of numbers it has converted. Whatever it hands out again after any number of collections is still the right text.
const shell = globalThis as any;
const collect: (full: boolean) => void = shell.Bun ? (full: boolean) => shell.Bun.gc(full) : (full: boolean) => (full ? shell.fullGC() : shell.edenGC());
const kept: string[] = [];
const keptOf: number[] = [];
let checked = 0;
let wrong = 0;
let length = 0;

function text(n: number): string {
  return String(n);
}

function check(n: number): void {
  const s = text(n);
  checked++;
  length += s.length;
  if (Number(s) !== n) wrong++;
}

for (let round = 0; round < 40; round++) {
  for (let i = 0; i < 1500; i++) {
    check(i);
    check(1024 + ((i * 7 + round) % 5000));
    check(100000 + i * 1024 + round);
    check(i + round / 4 + 0.125);
    check(-i - round);
  }
  for (let i = 0; i < 20; i++) {
    const n = round * 1000 + i * 37;
    kept.push(text(n));
    keptOf.push(n);
    const d = n + 0.5;
    kept.push(text(d));
    keptOf.push(d);
  }
  collect(round % 7 === 6);
  for (let i = 0; i < 300; i++) {
    check(i * 3);
    check(2000 + i + round);
    check(i / 8);
  }
  collect(false);
  collect(false);
}
let keptWrong = 0;
for (let i = 0; i < kept.length; i++) if (Number(kept[i]) !== keptOf[i] || kept[i] !== text(keptOf[i])) keptWrong++;
let many = 0;
for (let i = 0; i < 30000; i++) many += text(i * 13 + 5000).length + text(i * 0.75).length;
collect(false);
for (let i = 0; i < 30000; i += 97) check(i * 13 + 5000);
console.log(checked, wrong, length, kept.length, keptWrong, many);
