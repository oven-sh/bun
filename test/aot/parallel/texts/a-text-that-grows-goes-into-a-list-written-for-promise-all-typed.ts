const unseen = (0, eval)("(x) => x") as <T>(x: T) => T;
const show = (value: unknown): string => Array.isArray(value) ? "[" + value.map(show).join(",") + "]" : String(value);
function gather(count: number): Promise<unknown>[] {
  const pending: Promise<unknown>[] = [];
  let line = "";
  for (let i = 0; i < count; i++) {
    pending.push(Promise.all([line, i]));
    line += "k" + i;
  }
  pending.push(Promise.resolve(line));
  return pending;
}
let last = "";
for (let turn = 0; turn < 300; turn++) last = show(await Promise.all(gather(unseen(3))));
console.log(last);
console.log(show(await Promise.all(gather(unseen(5)))));
