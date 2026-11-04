import * as all from "./tools";
console.log((Reflect.get(all, "second") as any)(), JSON.stringify(all, ["value"]));