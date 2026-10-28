// The keys, extensibility and a descriptor of a namespace object.
import * as ns from "./m.mjs";
console.log(Object.keys(ns).join(), Object.isExtensible(ns), Object.isSealed(ns), JSON.stringify(Object.getOwnPropertyDescriptor(ns, "a")));
