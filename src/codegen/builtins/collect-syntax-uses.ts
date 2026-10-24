// Must come before ../replacements.ts: the two import each other, and builtin-parser.ts reads function_replacements while it loads.
import fs from "node:fs";
import path from "node:path";
import { census, censusOfText } from "../builtin-name-census.ts";
import { jscNames } from "../builtin-names.ts";
import "../builtin-parser.ts";
import { functionFiles, locate, sourceFiles } from "../builtins-manifest-model.ts";
import { define, globalsToPrefix, numberedClasses, numberedErrorCodes } from "../replacements.ts";
import type { SyntaxUses } from "./build-syntax.ts";
import type { ModelEngineFile } from "./model.ts";
import { compareBytes } from "./paths.ts";
import { errorKinds, type IntrinsicPosition } from "./vocabulary.ts";

const intrinsicDefinePrefix = "__intrinsic__";

function hostSourceFiles(bunRoot: string): string[] {
  const prelude = path.join(bunRoot, "src/aot/prelude");
  const preludeFiles = fs
    .readdirSync(prelude, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(".ts"))
    .map(entry => entry.name)
    .sort(compareBytes);
  const library = [...sourceFiles, ...functionFiles].map(locate);
  return [...library, ...preludeFiles.map(name => path.join(prelude, name))];
}

export function collectSyntaxUses(bunRoot: string, engineFiles: readonly ModelEngineFile[]): SyntaxUses {
  const definedNames = new Set(
    Object.keys(define)
      .filter(key => key.startsWith(intrinsicDefinePrefix))
      .map(key => key.slice(intrinsicDefinePrefix.length)),
  );
  const names = new Map<string, Set<IntrinsicPosition>>();
  const engineUses = engineFiles.flatMap(({ name, text }) => censusOfText(name, text));
  for (const { name, position } of [...census(hostSourceFiles(bunRoot)), ...engineUses]) {
    if (definedNames.has(name)) continue;
    const positions = names.get(name);
    if (positions === undefined) names.set(name, new Set([position]));
    else positions.add(position);
  }
  const bunNames = fs.readFileSync(path.join(bunRoot, "src/js/builtins/BunBuiltinNames.h"), "utf8");
  return {
    names,
    prefixedGlobals: [...globalsToPrefix, ...errorKinds],
    privateNames: [...jscNames.private, ...Array.from(bunNames.matchAll(/^\s*macro\((\w+)\)/gm), match => match[1])],
    errorCodes: numberedErrorCodes,
    inheritableClasses: numberedClasses,
  };
}
