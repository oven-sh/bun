// `N.g()` on a TypeScript namespace is called with the namespace object as `this`.
declare const console: { log(...a: unknown[]): void };
namespace N { export function g(this: unknown) { return typeof this; } }
console.log(N.g());
