// Flags: --aot-threads=1
import { twice } from "./early";
console.log(twice, Object.keys(require("./barrel")));
