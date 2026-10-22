// A generic class whose generic methods mention the class applied to their own type parameter, used from an untyped file: the class keeps its layout, and still accepts what untyped code hands it.
// IR+ ^layout L\d+ .*name="Wrapper" .* representation=Typed
// IR+ ^layout (L\d+) .*name="Wrapper" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
// IR+ ^layout (L\d+) .*name="Wrapper" [\s\S]*^function f\d+ "make" Plain .* -> (undefined\|null\|)?=?\1!?( |$)
import { idOf, make } from "./model.ts";
import { run } from "./use.js";
declare const console: { log(...values: unknown[]): void };
console.log(run().join(" "));
const typed = make(20);
typed.put({ id: 21 });
typed.put(make(22));
console.log(idOf(typed), typed.same(typed.value));
