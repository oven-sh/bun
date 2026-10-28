// A CommonJS module that throws while it is evaluated, and is asked for again. The next `require` evaluates it again, as under
// `bun run` and in Node; `import()` keeps the error. Each importer prints what every request got and how often the module was evaluated.
// (`bun build --compile` without --aot never evaluates it again: it hands out the half-made exports.)
import { type Case } from "./run-packages";

const requests = `const say = (what, v) => console.log(what, v);
const byRequire = () => { try { return JSON.stringify(require("./throws-twice.cjs")); } catch (e) { return "threw " + e.message; } };
const byImport = async () => { try { return JSON.stringify(await import("./throws-twice.cjs")); } catch (e) { return "threw " + e.message; } };
`;

export const cases: Case[] = [
  {
    name: "throws-twice",
    differs: "A CommonJS module of the executable runs at most once: where it threw, the next `require()` throws the same error again and does not run it anew.",
    files: {
      "throws-twice.cjs": `globalThis.evaluations = (globalThis.evaluations || 0) + 1;
exports.before = "before " + globalThis.evaluations;
if (globalThis.evaluations < 3) throw new Error("evaluation " + globalThis.evaluations);
exports.after = "after " + globalThis.evaluations;
`,
    },
    importers: {
      "require_only.cjs": `${requests}for (let i = 0; i < 4; i++) say("require", byRequire());
say("evaluations", globalThis.evaluations);
`,
      "require_only.ts": `// @ts-nocheck
${requests}for (let i = 0; i < 4; i++) say("require", byRequire());
say("evaluations", globalThis.evaluations);
`,
      "import_only.ts": `// @ts-nocheck
${requests}for (let i = 0; i < 4; i++) say("import()", await byImport());
say("evaluations", globalThis.evaluations);
`,
      "import_then_require.ts": `// @ts-nocheck
${requests}say("import()", await byImport()); say("require", byRequire()); say("import()", await byImport()); say("require", byRequire()); say("require", byRequire()); say("import()", await byImport());
say("evaluations", globalThis.evaluations);
`,
      "require_then_import.ts": `// @ts-nocheck
${requests}say("require", byRequire()); say("import()", await byImport()); say("require", byRequire()); say("import()", await byImport()); say("import()", await byImport());
say("evaluations", globalThis.evaluations);
`,
    },
  },
];
