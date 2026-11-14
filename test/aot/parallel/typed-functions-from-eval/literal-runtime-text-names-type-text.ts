// An object literal in text that becomes code at run time has the names of a declared type, one of whose objects the text was handed, and reaches a function that takes the type.
interface Payload { value: unknown; issues: string[]; aborted?: boolean }
function check(p: Payload): number { return p.issues.length + (p.aborted ? 1 : 0) + (typeof p.value === "number" ? p.value : 0); }
const text = process.env.OTHER_TEXT ?? "return check(i & 1 ? { value: i & 2 ? i : 'text', issues: [] } : given)";
const made = new Function("check", "given", "i", text) as (c: typeof check, given: Payload, i: number) => number;
const turns = 1000;
const given: Payload = { value: turns > 1 ? String(turns) : turns, issues: [] };
let sum = 0;
for (let i = 0; i < turns; i++) sum += made(check, given, i | 1);
console.log(sum);
