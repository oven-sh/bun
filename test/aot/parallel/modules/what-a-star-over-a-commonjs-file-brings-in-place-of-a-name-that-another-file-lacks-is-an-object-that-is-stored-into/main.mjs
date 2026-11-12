import { box, read } from "./index.mjs";
console.log("SAID", read());
box.n = "a";
console.log("SAID", read(), typeof box.n);
