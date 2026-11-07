// The function of the record is only ever called, and the call reads it by name from a receiver that may be any object.
import { attempt, holder, Other, otherHolder, pass, put, record, walk } from "./declared/index.js";
put(holder, pass("part"), record);
console.log(attempt(() => walk(holder, 3)));
put(holder, pass("part"), pass(new Proxy({}, { get: (_, key) => (key === "read" ? (i: number) => "trap" + i : 5) })));
console.log(attempt(() => walk(holder, 3)));
(otherHolder as any)["part"] = Object.assign(new Other(), { ["read"]: (i: number) => "own" + i });
