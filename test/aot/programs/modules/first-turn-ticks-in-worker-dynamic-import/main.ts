// A Worker whose entry point imports no builtin module calls `import()` on a module that imports node:fs, which the main thread's entry point imports too: what the main thread has loaded is not loaded here.
// The build lists start.ts first, so the main thread runs that and starts this file as a Worker.
await import("./imported.ts");
export {};
