// The enums stand in lists, and what is stored into is what a call returns. The keys are made at run time.
import { InList as C, InMap as A, InSet as B, OnlyRead as D } from "./kinds";
import { reads } from "./reads";
console.log(reads());
const key = ["O", "ne"].join("");
new Map<string, any>([["kind", A]]).get("kind")[key] = "far";
[...new Set<any>([B])].at(0)[key] = "far";
[C as any].at(0)[key] = "far";
console.log(reads(), [D].length);
