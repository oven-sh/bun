// A vm.SourceTextModule imports names of node:path, which link() hands over as a vm.SyntheticModule of the same context.
import * as path from "node:path";
import vm from "node:vm";
async function show(label, run) {
  try {
    console.log(label, JSON.stringify(await run()));
  } catch (error) {
    console.log(label, "threw", error?.constructor?.name, error?.code);
  }
}
await show("SourceTextModule", async () => {
  const context = vm.createContext({});
  const module = new vm.SourceTextModule(
    "import { sep, join } from 'node:path'; export const answer = join('a', 'b').length + sep.length;",
    { context },
  );
  await module.link(async () => {
    const names = Object.keys(path);
    return new vm.SyntheticModule(
      names,
      function () {
        for (const name of names) this.setExport(name, path[name]);
      },
      { context },
    );
  });
  await module.evaluate();
  return [module.status, module.namespace.answer];
});
