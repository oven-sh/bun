// Typed code. The slot of a field has one word for a function that is not made yet and another for a field that is absent, and a class and the classes below it share one slot.
// Alone: what is put off, and what is found constant, goes by all that the executable holds
const say = (run: () => unknown) => { try { console.log(run()); } catch (e) { console.log((e as Error).name + ": " + (e as Error).message); } };
import { withIt, without, undefinedIt } from "./m";
const show = (o: object) => Object.entries(o).map(([k, v]) => k + ":" + typeof v).join("/");
say(() => [withIt(), without(), undefinedIt()].map(o => ["f" in o, o.f === undefined, typeof o.f, Object.keys(o).join("/"), o.f?.()].join()).join(" "));
