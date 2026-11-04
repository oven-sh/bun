// Behind the first listed call of a list written for Promise.all a getter throws, so Promise.all is never called. The started function rejects later, and nobody handles that: the process is told, as of any promise that was dropped.
const log: string[] = [];
process.on("unhandledRejection", reason => log.push("unhandled " + (reason as Error).message));
async function late(x: number): Promise<number> {
  log.push("late begins " + x);
  await null;
  throw new Error("late " + x);
}
const holder = {
  get element(): number {
    log.push("the getter throws");
    throw new Error("no element");
  },
};
function deed(x: number) {
  try {
    return Promise.all([late(x), holder.element, late(x + 1)]);
  } catch (e) {
    return Promise.resolve([(e as Error).message]);
  }
}
console.log((await deed(1)).join());
await new Promise(resolve => setTimeout(resolve, 5));
for (let i = 2; i < 4; i++) console.log((await deed(i * 10)).join());
await new Promise(resolve => setTimeout(resolve, 5));
console.log(log.join(" | "));
