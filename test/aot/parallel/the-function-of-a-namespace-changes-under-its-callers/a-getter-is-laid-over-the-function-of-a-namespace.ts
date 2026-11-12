// a getter is laid over the member that is called: it runs once for each call
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
let gets = 0;
const kept = Debug.assert;
(Object as any)[hidden.define](Debug, hidden.assert, { get() { gets++; return kept; }, configurable: true });
tell(() => check(1));
tell(() => check(0));
console.log(gets, Debug.failures);
