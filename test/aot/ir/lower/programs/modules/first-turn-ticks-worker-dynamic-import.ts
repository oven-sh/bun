// RUN: lower
// OPTIONS: builtin-modules
// ENTRY: main.ts worker.ts
// STATISTIC: SourceFilesChecked = 3

// FILE: main.ts
// First turn ticks in worker dynamic import.
import { existsSync } from "node:fs";
const worker = new Worker("./worker.ts");
worker.onmessage = (event: MessageEvent) => {
  console.log(typeof existsSync, event.data);
  worker.terminate();
};

// FILE: imported.ts
import { existsSync } from "node:fs";
const log: string[] = ["imported in the worker", typeof existsSync];
process.nextTick(() => log.push("tick"));
Promise.resolve().then(() => log.push("promise job"));
setImmediate(() => postMessage(log.join(", ")));
export {};

// FILE: worker.ts
// A Worker whose entry point imports no builtin module calls `import()` on a module that imports node:fs, which the main thread's entry point imports too: what the main thread has loaded is not loaded here.
// The build lists main.ts first, so the main thread runs that and starts this file as a Worker.
await import("./imported.ts");
export {};

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
