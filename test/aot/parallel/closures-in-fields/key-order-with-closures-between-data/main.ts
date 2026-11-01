// Typed code. The slot of a field has one word for a function that is not made yet and another for a field that is absent, and a class and the classes below it share one slot.
// Alone: what is put off, and what is found constant, goes by all that the executable holds
const say = (run: () => unknown) => { try { console.log(run()); } catch (e) { console.log((e as Error).name + ": " + (e as Error).message); } };
import { make, lit } from "./m";
say(() => [Object.keys(make()).join(""), Object.keys(lit()).join(""), JSON.stringify(make()), Object.keys({ ...make(), z: 1 }).join("")].join());
