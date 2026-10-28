const weights = [];
for (let at = 0; at < 200000; at++) weights.push({ at, text: "weight " + at, list: [at, at + 1], next: at ? weights[at - 1] : null });

let check = 0;
for (let round = 0; round < 12000; round++) {
  const length = 16 + (round % 17);
  let text = "{";
  for (let i = 0; i < length; i++) text += (i ? "," : "") + '"n' + round + "_" + i + '":' + (round + i);
  const parsed = JSON.parse(text + "}");
  const copy = round & 1 ? { ...parsed } : Object.assign({}, parsed);
  let sum = 0;
  for (const name in copy) sum += copy[name];
  check = (check + sum) | 0;
}
console.log(check, weights.length);
