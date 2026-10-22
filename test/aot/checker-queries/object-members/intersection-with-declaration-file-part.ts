// An intersection of a type of the program with one of a declaration file. A member is written if every part that declares it writes it: one that the program alone declares is, one that the declaration file declares, alone or too, is not.
/// <reference path="./intersection-with-declaration-file-part.d.ts" />
interface Mine { own: number; shared: number }
declare const both: Mine & Theirs;
both.own;
both.shared;
both.foreign;
export {};
