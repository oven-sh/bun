// @ts-nocheck
// `bun run` has the length of a text, and a constant from outside the enum's block, in place of the reads in the enum's own file. Other files read the object there, so they see a store, and the name of a number that lands on a member.
import { Kind, Odd, ownReads, spoil } from "./kinds";
console.log(String(Odd.NaN), String(Odd.Infinity), ownReads().join());
spoil();
(Kind as any).Next = 8;
console.log(Kind.Length, Kind.Next, Kind["Length"], ownReads().join());
