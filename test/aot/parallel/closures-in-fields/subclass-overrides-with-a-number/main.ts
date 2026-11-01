// Typed code. The slot of a field has one word for a function that is not made yet and another for a field that is absent, and a class and the classes below it share one slot.
// Alone: what is put off, and what is found constant, goes by all that the executable holds
const say = (run: () => unknown) => { try { console.log(run()); } catch (e) { console.log((e as Error).name + ": " + (e as Error).message); } };
import { A, B, C } from "./m";
say(() => [new A(), new B(), new C()].map(o => [typeof o.f, typeof o.f === "function" ? (o.f as () => number)() : o.f, Object.keys(o).join("/")].join()).join(" "));
