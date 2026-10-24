// `import y = N.x` takes the value once, where the statement stands.
declare const console: { log(...a: unknown[]): void };
namespace N { export let x = 1; }
import y = N.x;
N.x = 2;
console.log(y);
