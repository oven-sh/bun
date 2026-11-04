// RUN(RIGHT): lower
// RUN(WRONG): link
// ENTRY: packages/right/src/right.ts packages/wrong/src/wrong.ts
// LINK: node_modules/@workspace/right -> packages/right

// A package that is not built, and that the project of the importing file does not refer to, has no declarations: `Rule` names nothing there, which stops no build, and the position is untyped.
// That an entry point lies in the package changes nothing, whichever of the two comes first. In the package itself `Rule` is the interface.
// RIGHT: [[literal]] = Data
// RIGHT-NEXT: Convert [[literal]] declared={type=undefined|null|[[Rule]] flags=[OmitsNull, OmitsUndefined]}
// WRONG: module [[wrong]] path="{{*}}/wrong.ts"
// WRONG: function {{*}}module=[[wrong]] kind=Module
// WRONG: [[rule]] = Data
// WRONG-NOT: Convert [[rule]]
// WRONG: PropGet [[rule]] key="level"

// FILE: package.json
{"name":"workspace","workspaces":["packages/*"]}

// FILE: tsconfig.json
{"files":[],"references":[{"path":"packages/wrong"}]}

// FILE: packages/right/package.json
{"name":"@workspace/right","version":"1.0.0","main":"lib/index.js","types":"lib/index.d.ts"}

// FILE: packages/right/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","types":[],"strict":true,"composite":true,"outDir":"lib","rootDir":"src"},"include":["src"]}

// FILE: packages/right/src/index.ts
export interface Rule {
  level: number;
}

// FILE: packages/right/src/right.ts
import type { Rule } from "./index";
const rule: Rule = { level: 2 };
console.log(rule.level);

// FILE: packages/wrong/package.json
{"name":"@workspace/wrong","version":"1.0.0"}

// FILE: packages/wrong/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","types":[],"strict":true,"composite":true,"outDir":"lib","rootDir":"src"},"include":["src"]}

// FILE: packages/wrong/src/wrong.ts
import type { Rule } from "@workspace/right";
const rule: Rule = { level: 1 };
console.log(rule.level);
