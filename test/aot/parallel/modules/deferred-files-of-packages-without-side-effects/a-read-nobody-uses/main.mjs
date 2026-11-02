// `import defer * as later` of a file whose package declares "sideEffects": false: a read of `later` asks the object of that very file and runs it with all that it imports.
import defer * as later from "./front.mjs";
later.value;
console.log(globalThis.sourceRan);
