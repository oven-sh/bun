// RUN: link
// The file that a Worker starts from is found while the program loads. It is compiled like a file that the program imports, whichever tsconfig.json lies nearest to it:
// one that says something else than the program's, one that says the same.
// CHECK: module {{*}}displayPath="lenient/worker.ts"
// CHECK: module {{*}}displayPath="strict/worker.ts"

// FILE: main.ts
const lenient = new Worker(new URL("./lenient/worker.ts", import.meta.url));
const strict = new Worker("./strict/worker.ts");
lenient.postMessage(1);
strict.postMessage(2);

// FILE: tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true}}

// FILE: lenient/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":false}}

// FILE: lenient/worker.ts
onmessage = event => postMessage(event.data * 10);

// FILE: strict/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true}}

// FILE: strict/worker.ts
onmessage = event => postMessage(event.data * 10);
