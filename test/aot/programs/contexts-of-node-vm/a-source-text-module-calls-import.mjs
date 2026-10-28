// A vm.SourceTextModule awaits an import() of node:path, which its loader answers.
import "node:path";
import vm from "node:vm";
async function show(label, run) {
  try {
    console.log(label, JSON.stringify(await run()));
  } catch (error) {
    console.log(label, "threw", error?.constructor?.name, error?.code);
  }
}
await show("SourceTextModule", async () => {
  const module = new vm.SourceTextModule("export const answer = typeof (await import('node:path')).join;", {
    context: vm.createContext({}),
    importModuleDynamically: specifier => import(specifier),
  });
  await module.link(() => {
    throw new Error("nothing to link");
  });
  await module.evaluate();
  return module.namespace.answer;
});
