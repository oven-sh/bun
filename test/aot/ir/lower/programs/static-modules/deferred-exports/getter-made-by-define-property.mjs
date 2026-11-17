// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2
// CHECK-LABEL: function {{*}}name="Patched"

// FILE: main.mjs
import assert, { ok } from "node:assert";
class Patched extends Error {}
assert.AssertionError = Patched;
const rest = await import("./rest.mjs");
ok(true);
console.log(rest.held() === Patched, rest.held().name, typeof rest.tracker());

// FILE: rest.mjs
import { AssertionError, CallTracker } from "node:assert";
export const held = () => AssertionError;
export const tracker = () => CallTracker;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
