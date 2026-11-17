const helpers = `const log = (...a) => console.log("| " + a.join(" "));
const T = f => { try { const v = f(); return typeof v === "function" ? "fn" : typeof v === "object" && v !== null ? "obj:" + Object.keys(v).sort().join("+") : String(v); } catch (e) { return e && e.name ? e.name : "thrown:" + String(e); } };
`;
const whole = `{ v: "mock v", f: () => "mock f", kept: "mock kept", default: "mock default" }`;

const kinds = ["mjs", "cjs"] as const;
const functions = ["mock.module", "jest.mock", "vi.mock", "jest.doMock", "vi.doMock"] as const;
const times = ["first", "behind-imports", "in-test-unloaded", "in-test-loaded", "preload", "before-all"] as const;

const secondFileWithUsersAlone =
  `import { test } from "bun:test";\n` +
  helpers +
  `test("z", async () => { globalThis.quiet = true; try { log("second file", (await import("./usern.mjs")).read()); } catch (e) { log("second file failed", e.name); } try { log("second file userc", import.meta.require("./userc.cjs").read()); } catch (e) { log("second file userc failed", e.name); } });\n`;

const inFolder = {
  mjs: `console.log("| the folder's lib runs");\nexport let v = "folder v";\nexport function f() { return "folder f"; }\nexport const kept = "folder kept";\nexport default "folder default";\n`,
  cjs: `console.log("| the folder's lib runs");\nexports.v = "folder v";\nexports.f = function () { return "folder f"; };\nexports.kept = "folder kept";\n`,
};

function factories(mock: string, path: string): Record<string, string | undefined> {
  const ofJest = mock.startsWith("jest");
  const original = ofJest ? `...jest.requireActual(${path})` : `...(await vi.importActual(${path}))`;
  return {
    whole: `() => { console.log("| factory runs"); return ${whole}; }`,
    partial: `() => { console.log("| factory runs"); return { v: "mock v" }; }`,
    actual: `${ofJest ? "" : "async "}() => { console.log("| factory runs"); return { ${original}, v: "mock v" }; }`,
    earlier: `() => { console.log("| factory runs"); return { ...original, v: "mock v" }; }`,
    micro: `async () => { console.log("| factory begins"); await null; console.log("| factory ends"); return ${whole}; }`,
    timer: `async () => { console.log("| factory begins"); await new Promise(r => setTimeout(r, 5)); console.log("| factory ends"); return ${whole}; }`,
    throws: `() => { console.log("| factory runs"); throw new Error("factory boom"); }`,
    marked: `() => { console.log("| factory runs"); return { __esModule: true, default: "mock default", v: "mock v" }; }`,
    none: undefined,
    folder: undefined,
  };
}

function shared(kind: (typeof kinds)[number], path: string): Record<string, string> {
  const files: Record<string, string> =
    kind === "mjs"
      ? {
          "lib.mjs": `import { base } from "./base.mjs";\nconsole.log("| lib runs");\nexport let v = "real v";\nexport function f() { return "real f"; }\nexport const kept = "kept:" + base;\nexport default "real default";\n`,
          "base.mjs": `console.log("| base runs");\nexport const base = "base";\n`,
        }
      : {
          "lib.cjs": `const { base } = require("./base.cjs");\nconsole.log("| lib runs");\nexports.v = "real v";\nexports.f = function () { return "real f"; };\nexports.kept = "kept:" + base;\n`,
          "base.cjs": `console.log("| base runs");\nexports.base = "base";\n`,
        };
  files["user.mjs"] =
    helpers +
    `import * as ns from ${path};\nimport { v, f } from ${path};\nimport d from ${path};\nglobalThis.quiet || console.log("| user runs", T(() => v));\nexport const read = () => [T(() => v), T(() => f()), T(() => ns.kept), T(() => d), T(() => ns)].join(",");\n`;
  files["usern.mjs"] =
    helpers +
    `import * as ns from ${path};\nglobalThis.quiet || console.log("| usern runs", T(() => ns.v));\nexport const read = () => [T(() => ns.v), T(() => ns.f()), T(() => ns.kept), T(() => ns.default), T(() => ns)].join(",");\n`;
  files["userc.cjs"] =
    helpers +
    `const lib = require(${path});\nglobalThis.quiet || console.log("| userc runs", T(() => lib.v));\nexports.read = () => [T(() => lib.v), T(() => lib.f()), T(() => lib.kept), T(() => lib)].join(",");\nexports.late = () => T(() => require(${path}).v) + "," + T(() => require(${path}).kept);\n`;
  files["z.test.mjs"] =
    `import { test } from "bun:test";\n` +
    helpers +
    `import * as ns from ${path};\nlog("second file top", T(() => ns.v), T(() => ns.kept));\ntest("z", async () => { globalThis.quiet = true; log("second file", T(() => ns.v), T(() => import.meta.require(${path}).v), (await import("./usern.mjs")).read()); });\n`;
  files["package.json"] = `{ "name": "p", "type": "module" }`;
  return files;
}

/** One small graph (two test files > three users > lib > base) for each way to lay a mock on lib. Each file prints a line that starts with "| " for what it sees. */
export function mockSweep(): Map<string, Record<string, string>> {
  const projects = new Map<string, Record<string, string>>();
  for (const kind of kinds) {
    const path = `"./lib.${kind}"`;
    for (const mock of functions) {
      for (const [factoryName, factory] of Object.entries(factories(mock, path))) {
        if (!factory && mock === "mock.module") continue;
        const call = `${mock}(${path}${factory ? ", " + factory : ""});`;
        const before = factoryName === "earlier" ? `const original = { ...(await import(${path})) };\n` : "";
        for (const [time, userAlone] of times.flatMap(time => [[time, false] as const, [time, true] as const])) {
          if (userAlone && !["whole", "partial", "throws"].includes(factoryName)) continue;
          const importsFirst = time !== "in-test-unloaded" && time !== "before-all";
          let text = `import { test, mock, jest, vi, beforeAll } from "bun:test";\n` + helpers;
          if (time === "first") text += before + call + "\n";
          if (importsFirst) text += `import { read as readStatic } from "./usern.mjs";\n`;
          if (time === "behind-imports") text += before + call + "\n";
          text += `log("top");\n`;
          if (time === "before-all") text += `beforeAll(async () => {\n${before}${call}\n});\n`;
          text += `test("t", async () => {\n`;
          if (time.startsWith("in-test")) text += before + call + "\n";
          text += `const show = (tag, o) => log(tag, T(() => o), T(() => o.v), T(() => o.f()), T(() => o.kept), T(() => o.default));\n`;
          if (importsFirst) text += `log("static usern", T(() => readStatic()));\n`;
          for (const user of ["usern.mjs", "user.mjs"])
            text += `try { const u = await import("./${user}"); log("${user}", u.read()); } catch (e) { log("${user} failed", e.name); }\n`;
          text += `try { const c = import.meta.require("./userc.cjs"); log("userc", c.read(), c.late()); } catch (e) { log("userc failed", e.name); }\n`;
          text += `try { show("import()", await import(${path})); } catch (e) { log("import() failed", e.name); }\ntry { show("require()", import.meta.require(${path})); } catch (e) { log("require() failed", e.name); }\n`;
          text += `mock.restore();\ntry { show("restored import()", await import(${path})); } catch (e) { log("restored import() failed", e.name); }\ntry { show("restored require()", import.meta.require(${path})); } catch (e) { log("restored require() failed", e.name); }\n`;
          if (importsFirst) text += `log("restored static usern", T(() => readStatic()));\n`;
          text += "});\n";
          const files: Record<string, string> = { "a.test.mjs": text, ...shared(kind, path) };
          if (userAlone) files["z.test.mjs"] = secondFileWithUsersAlone;
          if (factoryName === "folder") files[`__mocks__/lib.${kind}`] = inFolder[kind];
          if (time === "preload") {
            files["setup.mjs"] =
              `import { mock, jest, vi } from "bun:test";\nconsole.log("| setup runs");\n` + before + call + "\n";
            files["bunfig.toml"] = `[test]\npreload = ["./setup.mjs"]\n`;
          }
          projects.set(
            `${kind}-${mock.replace(".", "-")}-${factoryName}-${time}${userAlone ? "-user-alone" : ""}`,
            files,
          );
        }
      }
    }
  }
  return projects;
}
