// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: UnprovenInt32 6

// A read of a position that is written `int32` breaks no promise, because every store into it was held to the promise. Two reads have no such store: what a `yield` gives, which the caller of `next()` chooses, and a field that a class only declares.
import type { int32 } from "bun";

const loose: any = JSON.parse("[1.5]");
class Above {
  declare onlyDeclared: int32;
  declare storedAtBirth: int32;
  made: int32 = 0;
  maybe?: int32;
  constructor() { this.storedAtBirth = 1; }
}
class Below extends Above {}
const above = new Above();
const below = new Below();
loose.push(above, below);
loose[1].onlyDeclared = loose[0];
loose[2].onlyDeclared = loose[0];

const byName: int32 = above.onlyDeclared;
const byText: int32 = above["onlyDeclared"];
const fromAbove: int32 = below.onlyDeclared;
let later: int32 = 0;
later = above.onlyDeclared;
const stored: int32 = above.storedAtBirth;
const made: int32 = below.made;
const present: int32 = above.maybe!;

function* taking(): Generator<int32, int32, int32> {
  const first: int32 = yield 1;
  let second: int32 = 0;
  second = yield 2;
  console.log(first, second);
  return yield 3;
}

console.log(byName, byText, fromAbove, later, stored, made, present, taking().next());
