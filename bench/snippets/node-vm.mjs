// @runtime node, bun
import * as vm from "node:vm";
import { bench, run } from "../runner.mjs";

const context = {
  animal: "cat",
  count: 2,
};

const script = new vm.Script("animal = 'hey'");

vm.createContext(context);

bench("new vm.Script(source)", () => {
  new vm.Script("animal = 'hey'");
});

bench("new vm.Script(source, { filename })", () => {
  new vm.Script("animal = 'hey'", { filename: "hey.js" });
});

let alternate = 0;
bench("new vm.Script(source, { filename }), two filenames in turn", () => {
  new vm.Script("animal = 'hey'", { filename: alternate++ & 1 ? "hey.js" : "hi.js" });
});

let distinct = 0;
bench("new vm.Script(source), a new source each call", () => {
  new vm.Script("count = " + distinct++);
});

bench("vm.Script.runInContext", () => {
  script.runInContext(context);
});

bench("vm.Script.runInContext, options object", () => {
  script.runInContext(context, { displayErrors: true });
});

bench("vm.Script.runInThisContext", () => {
  script.runInThisContext(context);
});

bench("vm.Script.runInNewContext", () => {
  script.runInNewContext(context);
});

bench("vm.runInContext", () => {
  vm.runInContext("animal = 'hey'", context);
});

bench("vm.runInNewContext", () => {
  vm.runInNewContext("animal = 'hey'", context);
});

bench("vm.runInThisContext", () => {
  vm.runInThisContext("animal = 'hey'", context);
});

bench("vm.createContext", () => {
  vm.createContext({ yo: 1 });
});

// Node needs --experimental-vm-modules for these.
if (vm.SourceTextModule) {
  const chain = (count, prefix) => {
    const modules = [];
    for (let i = 0; i < count; i++) {
      const source = i + 1 < count ? `import "${prefix}${i + 1}"; export const v = ${i};` : "export const v = 0;";
      modules.push(new vm.SourceTextModule(source, { identifier: prefix + i }));
    }
    return modules;
  };
  // Bun 1.3 has link(), and not linkRequests() and instantiate().
  const hasLinkRequests = typeof vm.SourceTextModule.prototype.linkRequests === "function";

  for (const count of [1_000, 4_000]) {
    const modules = chain(count, `linked${count}_`);
    const byIdentifier = new Map(modules.map(module => [module.identifier, module]));
    const linker = specifier => byIdentifier.get(specifier);
    // The link recurses once per module, so link the chain in pieces, the last module first.
    for (let i = count - 1; i > 0; i -= 200) await modules[i].link(linker);
    await modules[0].link(linker);
    const head = modules[0];

    bench(`${count} linked modules: link() of a new importer`, async () => {
      await new vm.SourceTextModule(`import "${head.identifier}";`).link(linker);
    });
    if (!hasLinkRequests) continue;
    bench(`${count} linked modules: linkRequests() + instantiate() of a new importer`, () => {
      const importer = new vm.SourceTextModule(`import "${head.identifier}";`);
      importer.linkRequests([head]);
      importer.instantiate();
    });
    const notLinked = new vm.SourceTextModule('import "nothing";');
    bench(`${count} linked modules: instantiate() of a new importer that fails`, () => {
      const importer = new vm.SourceTextModule(`import "notLinked"; import "${head.identifier}";`);
      importer.linkRequests([notLinked, head]);
      try {
        importer.instantiate();
      } catch {}
    });
  }

  if (hasLinkRequests) {
    for (const count of [8, 50]) {
      let made = 0;
      bench(`new chain of ${count} modules: linkRequests() + instantiate()`, () => {
        const modules = chain(count, `new${made++}_`);
        for (let i = 0; i < count; i++) modules[i].linkRequests(i + 1 < count ? [modules[i + 1]] : []);
        modules[0].instantiate();
      });
    }

    const synthetic = Array.from({ length: 100 }, () => new vm.SyntheticModule([], () => {}));
    const imports = synthetic.map((_, i) => `import "synthetic${i}";`).join("");
    bench("100 SyntheticModules: linkRequests() + instantiate() of a new importer", () => {
      const importer = new vm.SourceTextModule(imports);
      importer.linkRequests(synthetic);
      importer.instantiate();
    });
  }
}

await run();
