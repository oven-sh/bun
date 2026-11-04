// Outside hot code an element of an array is read and stored in line only where it is there; everything else is one call of a stub: a position at or behind the length, a hole, a position that is no index, storage of another kind, a value that the storage does not hold. Every kind of storage meets every kind of position and value, and the answers are those of plain Bun
import { run } from "./accesses.js";

console.log(run().join("\n"));
