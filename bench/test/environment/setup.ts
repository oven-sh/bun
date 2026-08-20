// Generates identical jsdom + React Testing Library test files for comparing
// per-file preloads with a persistent worker-level environment.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const files = Number(process.argv[2] ?? 100);
if (!Number.isSafeInteger(files) || files < 1 || files > 10_000) {
  throw new Error(`files must be an integer in [1, 10000], got ${files}`);
}

const root = import.meta.dir + "/suite";
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

const install = `
const keys = ["window", "document", "navigator", "Node", "Element", "HTMLElement"] as const;
function installDOM(target: typeof globalThis, dom: JSDOM) {
  for (const key of keys) {
    Object.defineProperty(target, key, {
      configurable: true,
      value: key === "window" ? dom.window : dom.window[key],
      writable: true,
    });
  }
}
function removeDOM(target: typeof globalThis) {
  for (const key of keys) delete (target as any)[key];
}
`;

writeFileSync(
  root + "/preload.ts",
  `import { JSDOM } from "jsdom";
import React from "react";
${install}
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
installDOM(globalThis, dom);
const { cleanup, render, within } = await import("@testing-library/react");
Object.assign(globalThis, { React, render, screen: within(document.body) });
afterAll(() => {
  cleanup();
  dom.window.close();
  delete (globalThis as any).React;
  delete (globalThis as any).render;
  delete (globalThis as any).screen;
  removeDOM(globalThis);
});
`,
);

writeFileSync(
  root + "/environment.ts",
  `import { JSDOM } from "jsdom";
import React from "react";
${install}
const bootstrap = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
installDOM(globalThis, bootstrap);
const { cleanup, render, within } = await import("@testing-library/react");
bootstrap.window.close();
removeDOM(globalThis);

export default {
  setup(testGlobal: typeof globalThis) {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
    installDOM(globalThis, dom);
    installDOM(testGlobal, dom);
    Object.assign(testGlobal, { React, render, screen: within(dom.window.document.body) });
    return {
      teardown() {
        cleanup();
        dom.window.close();
        delete (testGlobal as any).React;
        delete (testGlobal as any).render;
        delete (testGlobal as any).screen;
        removeDOM(testGlobal);
        removeDOM(globalThis);
      },
    };
  },
};
`,
);

writeFileSync(root + "/bunfig-preload.toml", `[test]\npreload = ["./preload.ts"]\n`);
writeFileSync(root + "/bunfig-environment.toml", `[test]\nenvironment = "./environment.ts"\n`);

for (let i = 0; i < files; i++) {
  writeFileSync(
    `${root}/component-${String(i).padStart(4, "0")}.test.ts`,
    `function Component() {
  return (globalThis as any).React.createElement("button", { type: "button" }, "lot ${i}");
}

test("renders component ${i}", () => {
  const { React, render, screen } = globalThis as any;
  render(React.createElement(Component));
  expect(screen.getByRole("button", { name: "lot ${i}" })).toBeInstanceOf(HTMLElement);
});
`,
  );
}

console.log(`wrote ${files} jsdom + React Testing Library files to ${root}`);
