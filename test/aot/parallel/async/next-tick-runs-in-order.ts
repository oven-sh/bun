// Callbacks of process.nextTick run in the order they were given, with their arguments.
const order: string[] = [];
process.nextTick((a: string, b: string) => order.push(a + b), "first", "!");
process.nextTick(() => order.push("second"));
await new Promise<void>(done => process.nextTick(() => process.nextTick(done)));
const error = await new Promise<Error>(done => process.nextTick(() => done(new Error("here"))));
console.log(order.join(" "), String(error));
