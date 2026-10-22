// Two ES modules import each other. The one that runs first can call the other's function declaration, and finds its `const` and `let` in their dead zones.
import { fromB, readLater } from "./a.mjs";
console.log(fromB, readLater());
