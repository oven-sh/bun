// `list.flatMap(f)` alone, in code that runs often: f gets the element, its index and the list itself, and `this` where a second argument is given.
// STATISTIC: ArrayChainsFused >= 4
const list = [1, 2, 3];
const texts = ["a", "bc"];
function kinds(): string {
  return list.flatMap((x, k, all) => [x, k, typeof all, all === list, all.length]).join();
}
function lengths(): number[] {
  return texts.flatMap(function (this: { extra: number }, text, k, all) {
    return [text.length + this.extra, all[k] === text ? 1 : 0];
  }, { extra: 10 });
}
function counted(...given: number[]): number[] {
  return given.flatMap(function () {
    return [arguments.length];
  });
}
function grown(): number[] {
  const own = [1, 2, 3];
  return own.flatMap((x, k, all) => {
    if (k === 0) all.push(9);
    return x === 2 ? [] : [[x], all.length];
  }) as number[];
}
function doubled(): number[] {
  return list.map(x => x * 2);
}
let seen = "";
for (let turn = 0; turn < 300; turn++) seen = `${kinds()} | ${lengths()} | ${counted(4, 5)} | ${JSON.stringify(grown())} | ${doubled()}`;
console.log(seen);
