function take(at, plain, loud) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const kit = plain ? { step: 1 } : { step: 2 };
  const pair = [kit.step + at, at];
  const mark = loud ? "!" : ".";
  const [a, b] = pair;
  return a + ":" + b + mark + work;
}
let one = "", other = "";
for (let round = 0; round < 300; round++) {
  one = take(round, true, (round & 1) === 1);
  other = take(round, false, (round & 1) === 1);
}
console.log(one, other);
