// answers: without-library
// # A descriptor lays a getter on a function object, under a name that is written, and the function asks itself under that name at every call. Where closures of that one function are all that arrives at the read, it expects the getter.
// # Each closure has a getter with captures of its own: the code calls what the lookup has found.
// # f1 = createLogger, f2 = log, f3 = enabled, f4 = enable
// # RUN(HELD): link accesses held mechanisms=all
// # HELD: read f2 {{*}} expects getter f3
// # HELD-NOT: expects getter
// # RUN(PROVEN): link accesses mechanisms=all
// # PROVEN-NOT: expects getter
// # RUN(WALK): walk f2 mechanisms=all
// # WALK: = GetCachedGetter {{*}}key="enabled"
// # WALK: = TypeTest {{*}}testedType=f3
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 3 of 3 of 3
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): any;
function createLogger(namespace: string): any { let override: boolean | null = null; const cached = namespace.length > 3; let calls = 0; function log(text: string) { if (!(log as any).enabled) return 0; calls++; return text.length + calls; } (log as any).namespace = namespace; Object.defineProperty(log, "enabled", { enumerable: true, configurable: false, get: function enabled() { return override !== null ? override : cached; }, set: function enable(value: boolean) { override = value; } }); return log; }
const first = createLogger("first");
const off = createLogger("off");
let sum = 0;
for (let i = 0; i < 300; i++) sum += first("abc") + off("abc");
report(sum);
off.enabled = true;
for (let i = 0; i < 300; i++) sum += first("abc") + off("abc");
report(sum);
report("end");
