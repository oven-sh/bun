import defer * as whole from "./second.mjs";
globalThis.peek = () => whole.value;
console.log("holder");
