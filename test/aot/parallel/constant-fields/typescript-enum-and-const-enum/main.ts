// Typed code. A field or a member of an enum is read as its constant only where no store gives it another value.
// Alone: what is put off, and what is found constant, goes by all that the executable holds
const say = (run: () => unknown) => { try { console.log(run()); } catch (e) { console.log((e as Error).name + ": " + (e as Error).message); } };
import { read, K } from "./m";
say(() => read());
(K as any).A = 9;
say(() => [read(), Object.keys(K).join("/")].join(" "));
