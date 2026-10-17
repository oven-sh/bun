// `arguments[0]` in a function without parameters that `then` calls with a typed object.
declare const console: { log(...a: unknown[]): void };
export interface R { m: () => number }
async function later(): Promise<R> { return { m: () => 1 }; }
function first(): unknown { return arguments[0].m; }
console.log(await later().then(first) === await later().then(first));
