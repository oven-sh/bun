// A type has the trust of the files that declare it. One that only a `.d.ts` declares keeps its shape and is untrusted, one that the program declares too is the program's, and one in the list of built-in types is a built-in class.
/// <reference path="./ambient.d.ts" />
declare global { interface Shared { b: number } }
interface Mine { c: number }
let v1: Host;
let v2: Map<string, number>;
let v3: Promise<void>;
let v4: Date;
let v5: Shared;
let v6: Literal;
let v7: Mine;
let v8: HostMode.Fast;
let v9: HostLevel;
let v10: HostLevel.Low;
let v11: typeof hostToken;
let v12: typeof HostLevel;
let v13: HostMode.Fast & { __brand: "mode" };
export {};
