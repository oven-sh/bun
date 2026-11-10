// STATISTIC: ConstantArrayElementsFolded >= 4
function weigh(n: number): string {
  let total = 0, texts = "";
  for (let i = 0; i < n; i++) {
    for (const part of [1, 2.5, -0, 1e21]) total += part * i;
    for (const part of [true, null, undefined, "t"]) texts = String(part).length + texts.slice(0, 6);
  }
  return total + " " + texts + " " + Object.is([-0][0], -0);
}
console.log(weigh(3), weigh(0));
