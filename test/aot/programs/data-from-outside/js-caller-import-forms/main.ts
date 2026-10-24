// A JavaScript file reaches the functions of full-types files through a namespace, a default export, a constructor, import(), require() and as a value that typed code hands over, and calls them with plain objects that have all the members of the class that the parameter names.
import { run } from "./caller.js";
import { one } from "./typedE.ts";
import old from "./old.cjs";
await run(one);
console.log("required: " + old());
