// A tree in one file: an imported function behind a link, a working directory below the root, and an error at its place.
// RUN: link
// RUN(MANY): link
// OPTIONS(MANY): threads=4
// SAME: CHECK MANY
// ENTRY: app/entry.ts
// CWD: app
// LINK: linked -> real
// DIAGNOSTIC: TS2322 real/twice.ts:2

// FILE: app/entry.ts
import { twice } from "../linked/twice";
export const four = twice(2);

// FILE: real/twice.ts
export const twice = (n: number) => n * 2;
export const wrong: number = "three";
