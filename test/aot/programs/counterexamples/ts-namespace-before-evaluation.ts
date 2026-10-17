// A function that a TypeScript namespace exports cannot be called above the namespace.
declare const console: { log(...a: unknown[]): void };
try { N.f(); console.log("ran"); } catch { console.log("threw"); }
namespace N { export function f() {} }
