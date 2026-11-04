// Typed code. A field or a member of an enum is read as its constant only where no store gives it another value.
const say = (run: () => unknown) => { try { console.log(run()); } catch (e) { console.log((e as Error).name + ": " + (e as Error).message); } };
import { read, F, E } from "./m";
F.A = 7;
(E as any).B = 9;
say(() => read());
