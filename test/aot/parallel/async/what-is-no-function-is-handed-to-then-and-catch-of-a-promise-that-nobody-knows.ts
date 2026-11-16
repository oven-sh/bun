const log: string[] = [];
const makers: ((amount: number) => any)[] = [amount => Promise.resolve(amount), amount => Promise.reject(new Error("no " + amount))];
function run(amount: number, handler: any): void {
  makers[amount % 2](amount).then(handler).catch(handler).then((value: any) => log.push("end " + String(value)), (error: Error) => log.push("passed on " + error.message));
}
const first = Number(process.argv[2] ?? 3);
for (const handler of [undefined, null, 7, "text", { then: 1 }, Symbol.iterator]) { run(first, handler); run(first + 1, handler); }
setTimeout(() => console.log(log.join("\n")), 5);
