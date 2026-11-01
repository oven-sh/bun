// Typed code. A class is made at the first read of its variable.
// Alone: what is put off, and what is found constant, goes by all that the executable holds
const say = (run: () => unknown) => { try { console.log(run()); } catch (e) { console.log((e as Error).name + ": " + (e as Error).message); } };
import { P } from "./m";
say(() => [new P(1).sum(), new P(1, 5).sum(), P.count, Object.keys(new P(1)).join("/")].join());
