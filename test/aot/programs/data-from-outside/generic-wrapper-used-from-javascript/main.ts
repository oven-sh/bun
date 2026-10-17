// A generic class whose generic methods mention the class applied to their own type parameter, used from an untyped file: the class keeps its layout, and still accepts what untyped code hands it.
// IR+ ^shape \d+ Instance "Wrapper" .*fixed-layout
// IR+ ^shape \d+ Instance "Wrapper" .*accepts-untyped
// IR+ ^function \d+ "make" Plain .*result undefined\|null\|Wrapper\.0
import { idOf, make } from "./model.ts";
import { run } from "./use.js";
declare const console: { log(...values: unknown[]): void };
console.log(run().join(" "));
const typed = make(20);
typed.put({ id: 21 });
typed.put(make(22));
console.log(idOf(typed), typed.same(typed.value));
