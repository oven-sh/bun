// Typed code. The slot of a field has one word for a function that is not made yet and another for a field that is absent, and a class and the classes below it share one slot.
// Alone: what is put off, and what is found constant, goes by all that the executable holds
const say = (run: () => unknown) => { try { console.log(run()); } catch (e) { console.log((e as Error).name + ": " + (e as Error).message); } };
import { A, B, C } from "./m";
say(() => [new A().f(), new B().f(), (new B() as any).g(), new C().f(), Object.keys(new C()).length, new C().f === new C().f].join());
