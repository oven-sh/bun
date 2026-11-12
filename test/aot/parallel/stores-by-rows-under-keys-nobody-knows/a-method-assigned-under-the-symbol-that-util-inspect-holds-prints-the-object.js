import { inspect } from "node:util";
const shelf = Object.assign({ count: 0 }, { [inspect.custom]: () => "printed by the method" });
console.log(shelf);
