const weights = [];
for (let at = 0; at < 100000; at++) weights.push({ at, text: "weight " + at, list: [at, at + 1], next: at ? weights[at - 1] : null });

let check = 0;
for (let round = 0; round < 4000; round++) {
  const object = {};
  const length = 16 + (round % 17);
  for (let i = 0; i < length; i++) object["n" + round + "_" + i] = round + i;
  let sum = 0;
  for (const name in object) sum += object[name];
  check = (check + sum) | 0;
}
console.log(check, weights.length);
