// `bun untyped-idioms.ts <where>` writes ./idioms there with each idiom as JavaScript beside the TypeScript: the same text without its types. Where somebody would write the
// JavaScript otherwise, as a class without declarations of its fields, a .js lies beside the .ts in ./idioms and is taken as it is.
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export function writeUntypedIdioms(where: string) {
  const root = join(import.meta.dir, "idioms");
  const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun", deadCodeElimination: false, inline: false });
  cpSync(root, where, { recursive: true });
  writeFileSync(join(where, "tsconfig.json"), JSON.stringify({ extends: join(root, "tsconfig.json") }));
  for (const path of readdirSync(root, { recursive: true }).map(String)) {
    const untyped = path.slice(0, -3) + ".js";
    if (path.endsWith(".ts") && path !== "host.ts" && !existsSync(join(root, untyped)))
      writeFileSync(join(where, untyped), transpiler.transformSync(readFileSync(join(root, path), "utf8")));
  }
}

if (import.meta.main) writeUntypedIdioms(process.argv[2]);
