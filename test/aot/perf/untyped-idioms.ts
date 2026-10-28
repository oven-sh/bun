// `bun untyped-idioms.ts <where>` writes each idiom of ./idioms there as JavaScript: the same text without its types. Where somebody would write the
// JavaScript otherwise, as a class without declarations of its fields, a .js lies beside the .ts in ./idioms and is taken as it is.
// The folder is that of a project of plain JavaScript: it holds no tsconfig.json, so nothing there names a package of types, and no TypeScript but host.ts.
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "idioms");

export function writeUntypedIdioms(where: string) {
  const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun", deadCodeElimination: false, inline: false });
  cpSync(root, where, {
    recursive: true,
    filter: path => path === join(root, "host.ts") || !(path.endsWith(".ts") || path.endsWith("tsconfig.json")),
  });
  for (const path of readdirSync(root, { recursive: true }).map(String)) {
    const untyped = path.slice(0, -3) + ".js";
    if (path.endsWith(".ts") && path !== "host.ts" && !existsSync(join(root, untyped)))
      writeFileSync(join(where, untyped), transpiler.transformSync(readFileSync(join(root, path), "utf8")));
  }
}

/** ./idioms as it is, under the options of its tsconfig.json. */
export function writeTypedIdioms(where: string) {
  cpSync(root, where, { recursive: true });
  writeFileSync(join(where, "tsconfig.json"), JSON.stringify({ extends: join(root, "tsconfig.json") }));
}

if (import.meta.main) writeUntypedIdioms(process.argv[2]);
