// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 3
// CHECK-LABEL: function {{*}}name="others"

// FILE: main.ts
// The project sets no "jsx", "module": "esnext", an old target and "importHelpers" without tslib. tsc refuses the import of a .tsx file (TS6142), each tag (TS17004), `import = require` (TS1202), `export =` (TS1203) and the rest element (TS2354): rules about what tsc would write. Plain Bun runs the program, and so does a build.
import api = require("./lay");
import { view } from "./view";
function others(o: { a: number; b: number; c: number }) { const { a, ...rest } = o; return rest; }
console.log(api(), view, others({ a: 1, b: 2, c: 3 }));

// FILE: lay.ts
function api(): number { return 1; }
export = api;

// FILE: view.tsx
/** @jsxRuntime classic */
/** @jsx h */
declare global { namespace JSX { interface IntrinsicElements { box: { size: number } } interface Element { tag: string; props: object } } }
function h(tag: string, props: object | null): JSX.Element { return { tag, props: props ?? {} }; }
export const view = <box size={3} />;

// FILE: tsconfig.json
{ "compilerOptions": { "strict": true, "target": "es2017", "module": "esnext", "moduleResolution": "bundler", "importHelpers": true, "typeRoots": [ "../../../../../packages" ], "types": [ "bun-types" ], "noEmit": true } }
