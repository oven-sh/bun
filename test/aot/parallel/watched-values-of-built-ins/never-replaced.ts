// never replaced
// COUNT: operation:operationAOTGetByIdAndCache = 0
// COUNT: operation:operationAOTFillWatchedBuiltinValue = 1
const k: string = JSON.parse('"env"');
const p: any = process;
const seen: unknown[] = [];
const first = process.env;
function look() { seen.push(process.env === first, typeof process.env, (process.env as any)?.WATCHED); }
p[k + "NotAMember"] = 1;
let n = 0;
for (let i = 0; i < 5000; i++) if (process.env === first) n++; // @ts-expect-error
globalThis.said = n;
