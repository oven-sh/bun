// A vm.SyntheticModule is linked and evaluated, and its namespace is read.
import vm from "node:vm";
async function show(label, run) {
  try {
    console.log(label, JSON.stringify(await run()));
  } catch (error) {
    console.log(label, "threw", error?.constructor?.name, error?.code);
  }
}
await show("SyntheticModule", async () => {
  const module = new vm.SyntheticModule(["a", "b"], function () {
    this.setExport("a", 1);
    this.setExport("b", [2]);
  });
  await module.link(() => {});
  await module.evaluate();
  return [module.status, module.namespace.a, module.namespace.b, Object.keys(module.namespace)];
});
