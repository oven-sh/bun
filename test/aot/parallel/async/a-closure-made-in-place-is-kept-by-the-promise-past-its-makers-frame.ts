const log: string[] = [];
let settle: ((value: number) => void)[] = [];
const makers: (() => any)[] = [() => new Promise<number>(resolve => settle.push(resolve)), () => new Promise<number>((_, reject) => settle.push(reject))];
function run(amount: number, text: string): void {
  const local = { amount, text };
  makers[amount % 2]()
    .then((value: number) => { log.push("then " + local.amount + " " + local.text + " " + value); return value; })
    .catch((value: number) => { log.push("caught " + local.amount + " " + local.text + " " + value); });
}
function deep(depth: number): number { return depth ? deep(depth - 1) + depth : 0; }
const first = Number(process.argv[2] ?? 3);
for (let amount = first; amount < first + 6; amount++) run(amount, "text " + amount);
deep(200);
Bun.gc(true);
settle.forEach((resolve, index) => resolve(index));
Bun.gc(true);
setTimeout(() => console.log(log.join("\n")), 5);
