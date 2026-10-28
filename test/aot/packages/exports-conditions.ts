// Which file of a package is loaded for `import`, for `require` and for a TypeScript importer, by the conditions in "exports" and by "main" and "module". Every file prints its own name.
import { pkg, ways, type Case } from "./run-packages";

const declarations = `export declare const which: string;
export declare function f(): string;
declare const d: string;
export default d;
`;

// What goes into package.json. Every file that is named here is made below, and exports its own name as `which`.
const fields: Record<string, Record<string, unknown>> = {
  basic: {"exports": {".": {"types": "./index.d.ts", "import": "./esm.mjs", "require": "./cjs.cjs", "default": "./def.js"}}},
  "bun-node": {"exports": {".": {"types": "./index.d.ts", "bun": "./bun.js", "node": "./node.js", "default": "./def.js"}}},
  "node-nested": {"exports": {".": {"types": "./index.d.ts", "node": {"import": "./n.mjs", "require": "./n.cjs"}, "default": "./d.js"}}},
  "sugar-string": {"exports": "./index.js", "types": "./index.d.ts"},
  "sugar-conditions": {"exports": {"types": "./index.d.ts", "import": "./e.mjs", "require": "./c.cjs"}},
  "default-first": {"exports": {".": {"types": "./index.d.ts", "default": "./d.js", "import": "./e.mjs"}}},
  array: {"exports": {".": [{"types": "./index.d.ts", "import": "./e.mjs"}, "./c.cjs"]}, "types": "./index.d.ts"},
  "dev-prod": {"exports": {".": {"types": "./index.d.ts", "development": "./dev.js", "production": "./prod.js", "default": "./def.js"}}},
  "module-condition": {"exports": {".": {"types": "./index.d.ts", "module": "./m.mjs", "import": "./e.mjs", "require": "./c.cjs"}}},
  "main-and-module": {"main": "./c.cjs", "module": "./m.mjs", "types": "./index.d.ts"},
  "exports-over-main": {"main": "./m.js", "exports": {".": {"types": "./index.d.ts", "default": "./e.js"}}},
  "browser-condition": {"exports": {".": {"types": "./index.d.ts", "browser": "./b.js", "default": "./d.js"}}},
  "react-server": {"exports": {".": {"types": "./index.d.ts", "react-server": "./rs.js", "default": "./d.js"}}},
  "module-sync": {"exports": {".": {"types": "./index.d.ts", "module-sync": "./ms.mjs", "require": "./c.cjs", "default": "./e.mjs"}}},
  "import-only": {"exports": {".": {"types": "./index.d.ts", "import": "./e.mjs"}}},
  "require-only": {"exports": {".": {"types": "./index.d.ts", "require": "./c.cjs"}}},
  "types-last": {"exports": {".": {"import": "./e.mjs", "require": "./c.cjs", "types": "./index.d.ts"}}},
  "types-by-condition": {"exports": {".": {"import": {"types": "./index.d.mts", "default": "./e.mjs"}, "require": {"types": "./index.d.cts", "default": "./c.cjs"}}}},
  "type-module": {"type": "module", "exports": {".": {"types": "./index.d.ts", "import": "./e.js", "require": "./c.cjs"}}},
  "type-module-main": {"type": "module", "main": "./e.js", "types": "./index.d.ts"},
  "bun-is-typescript": {"exports": {".": {"bun": "./src.ts", "types": "./index.d.ts", "default": "./d.js"}}},
};

const differs = "A static import that cannot be resolved is an error of the build; `bun run` reports it when the file is loaded. A require() or an import() that cannot be resolved throws where it runs, as under `bun run`.";

const paths = (value: unknown): string[] => (typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(paths) : []);

function text(name: string, path: string, isModule: boolean) {
  const which = `${name}:${path}`;
  if (path.endsWith(".d.cts")) return `export declare const which: string;\nexport declare function f(): string;\n`;
  if (/\.d\.m?ts$/.test(path)) return declarations;
  if (path.endsWith(".ts")) return `export const which: string = "${which}";\nexport function f(): string { return "f of " + which; }\nconst d: string = "default of ${which}";\nexport default d;\n`;
  if (path.endsWith(".mjs") || (isModule && path.endsWith(".js"))) return `export const which = "${which}";\nexport function f() { return "f of " + which; }\nexport default "default of ${which}";\n`;
  return `exports.which = "${which}";\nexports.f = function f() { return "f of " + exports.which; };\nexports.default = "default of ${which}";\n`;
}

export const cases: Case[] = Object.entries(fields).map(([name, packageJson]) => {
  const packageName = "c_" + name.replaceAll("-", "_");
  const named = [...paths(packageJson.exports), ...paths(packageJson.main), ...paths(packageJson.module), "./index.d.ts"].map(path => path.slice(2));
  return {
    name,
    // A package that has no file for the way it is asked for is not found under `bun run` either.
    ...(name === "require-only" || name === "import-only" ? { fails: true as const } : {}),
    differs,
    files: pkg(packageName, Object.fromEntries(named.map(path => [path, text(packageName, path, packageJson.type === "module")])), packageJson),
    importers: ways(packageName, ["which", "f"], { tag: "x" }),
  };
});
