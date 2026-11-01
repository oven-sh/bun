// Typed code. The slot of a field has one word for a function that is not made yet and another for a field that is absent, and a class and the classes below it share one slot.
// Alone: what is put off, and what is found constant, goes by all that the executable holds
const say = (run: () => unknown) => { try { console.log(run()); } catch (e) { console.log((e as Error).name + ": " + (e as Error).message); } };
import { A } from "./m";
say(() => [new A().call(), A.s(), new A().same(), Object.keys(A).join("/"), A.s === A.s].join());
