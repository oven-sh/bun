// A member declared in a `.d.ts` is unwritten, also in a merged interface; one the program declares is written.
/// <reference path="./declaration-file-member.d.ts" />
declare global { interface Merged { b: number } }
declare const h: Host;
declare const m: Merged;
h.port;
m.a;
m.b;
export {};
