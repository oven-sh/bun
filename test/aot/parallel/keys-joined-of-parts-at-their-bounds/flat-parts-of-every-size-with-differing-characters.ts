const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!#$%&()*+,-./:;<=>?@[]^_{|}~";
const fronts: string[] = JSON.parse(JSON.stringify(Array.from({ length: 71 }, (_, size) => alphabet.slice(0, size))));
const numbers: number[] = JSON.parse("[0,10,999,10000,99999999,100000000,2147483647,-1,-2147483648]");
const held: Record<string, number> = {}; let bad = 0, total = 0;
for (let round = 0; round < 2; round++) for (const front of fronts) for (const n of numbers) { const key = `${front}${n}`; held[key] = round; if (key !== [front, n].join("")) bad++; total += key.length; }
console.log(bad, total, Object.keys(held).length);
