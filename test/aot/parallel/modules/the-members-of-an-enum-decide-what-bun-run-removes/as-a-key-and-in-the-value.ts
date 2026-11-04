// @ts-nocheck
enum E { A = 1 }
const o = { [E.A]: E.A ? 1 : module };
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
