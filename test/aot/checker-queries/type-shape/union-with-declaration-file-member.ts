// A union lists its members, and each has its own trust: a member of a declaration file takes nothing from the one beside it.
/// <reference path="./union-with-declaration-file-member.d.ts" />
interface Mine { a: number }
let v1: Mine | Theirs;
let v2: string | Theirs;
let v3: Mine;
let v4: Theirs;
export {};
