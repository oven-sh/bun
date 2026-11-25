// Typed code. A class is made at the first read of its variable.
const say = (run: () => unknown) => { try { console.log(run()); } catch (e) { console.log((e as Error).name + ": " + (e as Error).message); } };
import { P } from "./m";
say(() => [new P(1).sum(), new P(1, 5).sum(), P.count, Object.keys(new P(1)).join("/")].join());
