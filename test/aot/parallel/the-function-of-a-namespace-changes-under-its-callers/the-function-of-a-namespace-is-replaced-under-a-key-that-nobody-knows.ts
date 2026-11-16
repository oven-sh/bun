// the member that is called holds another function from now on
namespace Debug { export let failures = 0; export function assert(condition: unknown, message: string) { if (!condition) fail(message); } export function fail(message: string): never { failures++; throw new Error(message); } export function who(this: unknown) { return this === Debug; } export function count(..._: unknown[]) { return arguments.length; } }
const hidden: any = JSON.parse(`{"assert":"assert","who":"who","define":"defineProperty","remove":"deleteProperty","box":{}}`);
function patch(name: string, value: unknown) { (Debug as any)[name] = value; }
function check(n: number) { Debug.assert(n > 0, "positive"); return n; }
function tell(f: () => unknown) { try { console.log(f()); } catch (e) { console.log((e as Error).name, (e as Error).message); } }
hidden.box.it = Debug;
let last = 0;
for (let i = 1; i < 300; i++) last = check(i);
console.log(last);
tell(() => check(0));
patch(hidden.assert, (condition: unknown, message: string) => { console.log("patched", condition, message); });
tell(() => check(0));
tell(() => check(1));
console.log(Debug.failures);
