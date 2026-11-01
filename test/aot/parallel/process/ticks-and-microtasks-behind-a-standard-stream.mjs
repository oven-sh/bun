// A tick that is queued from inside a microtask comes before the microtasks that wait only where nothing has read process.nextTick before. Whoever reads a standard stream has read it.
// STATISTIC: ImageFunctionsEmitted <= 200
console.log(process.stdout.isTTY === true);
await 1;
queueMicrotask(() => console.log("microtask"));
process.nextTick(() => console.log("tick"));
await new Promise(resolve => setTimeout(resolve, 1));
process.on("beforeExit", () => process.stdout.write("before exit\n"));
process.on("exit", code => process.stdout.write("exit " + code + "\n"));
queueMicrotask(() => process.stdout.write("second microtask\n"));
process.nextTick(() => process.stdout.write("second tick\n"));
