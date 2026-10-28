// A text that runs in a context of node:vm, or in this context, calls import() and no loader was given.
import vm from "node:vm";
async function show(label, run) {
  try {
    console.log(label, JSON.stringify(await run()));
  } catch (error) {
    console.log(label, "threw", error?.constructor?.name, error?.code);
  }
}
await show("a new context", async () => typeof (await vm.runInNewContext("import('node:path')")).join);
await show("this context", async () => typeof (await vm.runInThisContext("import('node:path')")).join);
