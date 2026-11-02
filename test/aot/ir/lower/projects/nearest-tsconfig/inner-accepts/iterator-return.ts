// RUN: lower

// FILE: main.ts
import "./inner/lib.ts";

// FILE: tsconfig.json
{"compilerOptions":{"target":"esnext","module":"preserve","moduleResolution":"bundler","noEmit":true,"allowImportingTsExtensions":true,"strict":true,"skipLibCheck":true}}

// FILE: inner/tsconfig.json
{"compilerOptions":{"target":"esnext","module":"preserve","moduleResolution":"bundler","noEmit":true,"allowImportingTsExtensions":true,"strict":true,"skipLibCheck":true,"strictBuiltinIteratorReturn":false}}

// FILE: inner/lib.ts
const r = [1].values().next();
if (r.done) { const s: string = r.value; console.log(s); }
console.log(r.done);
