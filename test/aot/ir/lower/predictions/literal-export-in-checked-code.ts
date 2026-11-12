// The checker gives the name that a store to `exports` declares the literal of the store. Checked code that rests on it passes `bun check`, so it builds.
// RUN: lower
// CHECK-LABEL: function {{*}}name="pick"
// CHECK: Return

// FILE: main.ts
import { MODE } from "./modes.cjs";

export function pick(): "fast" | "slow" {
  return MODE;
}

// FILE: modes.cjs
exports.MODE = "fast";

// FILE: tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","types":[],"strict":true,"allowJs":true,"noEmit":true}}
