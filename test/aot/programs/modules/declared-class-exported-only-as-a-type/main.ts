// A class of a declaration file that is exported only as a type, through two modules and a star: taking the namespace object does not read it.
import * as everything from "./generic";
console.log(Object.keys(everything).sort().join(","));
console.log(Object.keys(await import("./generic")).sort().join(","));
