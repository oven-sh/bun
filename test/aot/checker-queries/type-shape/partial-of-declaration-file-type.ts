// A mapped type over a type of a declaration file has the trust of that type: nobody checked what it says.
/// <reference path="./partial-of-declaration-file-type.d.ts" />
let v1: Partial<Theirs>;
let v2: Readonly<Theirs>;
let v3: Pick<Theirs, "a">;
export {};
