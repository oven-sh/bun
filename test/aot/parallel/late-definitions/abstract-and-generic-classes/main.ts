// Typed code. A class is made at the first read of its variable.
const say = (run: () => unknown) => { try { console.log(run()); } catch (e) { console.log((e as Error).name + ": " + (e as Error).message); } };
import { A, B, C } from "./m";
say(() => [new B().twice().join(), JSON.stringify(new C("x").twice()), new B() instanceof A, Object.getPrototypeOf(C) === A].join(" "));
