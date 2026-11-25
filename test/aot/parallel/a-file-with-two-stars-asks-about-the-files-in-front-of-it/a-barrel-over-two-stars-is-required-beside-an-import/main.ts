// Flags: --aot-threads=1
import { seen } from "./apart";
console.log(seen, Object.keys(require("./barrel")));
