// `import v = all.v2` reads the name off the object.
import * as all from "./t3";
import two = all.v2;
console.log(two, all.v0);
