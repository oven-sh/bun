// Methods and functions whose parameters are checked where they are entered reach each other by name, through a list, and through `call`, `apply` and `bind`. One function only reads `call` of another and never calls it. Built with every pass verified.
type Value = number | string;
const table = {
  first(n: number, ...rest: Value[]): string {
    return n <= 0 ? "end" : picked[(n + 2) % picked.length](n - 1, rest[0], rest[1]) + "|" + rest[0];
  },
  second(n: number, ...rest: Value[]): string {
    return n % 3 === 0 ? table[names[0]](n - 1, rest[0], rest[1]) : table.first.apply(undefined, [n - 1, ...rest]);
  },
};
const names = ["first", "second"] as const;
const picked = [table.first, table.second];
console.log(table[names[1]](10, "a", 1));

function scale(this: { factor: number } | undefined, amount: number): number {
  return amount * (this ? this.factor : 1);
}
function total(amounts: number[]): number {
  let sum = 0;
  for (const amount of amounts) sum += scale.call({ factor: 2 }, amount) + scale.apply(undefined, [amount]);
  return sum;
}
function readsWithoutCalling(): boolean {
  return scale.call === Function.prototype.call && typeof scale.bind === "function";
}
const given: unknown[] = [1, 2.5, 3];
console.log(total(given as number[]), readsWithoutCalling(), scale.bind({ factor: 3 })(given[1] as number));
export {};
