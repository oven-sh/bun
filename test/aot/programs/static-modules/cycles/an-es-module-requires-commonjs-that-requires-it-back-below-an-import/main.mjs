// a.mjs, loaded by an import, requires k.cjs in the middle of its body, and k.cjs requires a.mjs back: it gets the namespace object, live, with dead zones.
import { seen, readLater } from "./a.mjs";
console.log(seen, readLater());
