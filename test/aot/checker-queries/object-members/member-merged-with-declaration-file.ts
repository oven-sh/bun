// An interface that the program and a declaration file both declare. What the program alone declares is written. What the declaration file declares is not, and neither is a method whose overloads come from both.
/// <reference path="./member-merged-with-declaration-file.d.ts" />
declare global { interface Shared { mine: number; both(value: number): number } }
declare const shared: Shared;
shared.mine;
shared.theirs;
shared.both;
export {};
