// The entry point imports two CommonJS files, and the second requires the entry point: the first has run by then, and neither runs again. The output is stored: plain Bun begins the second before the first in about one run in ten on a busy machine.
import first from "./first.cjs";
import second from "./second.cjs";
export const value = "main";
console.log("the entry point runs", JSON.stringify(first), JSON.stringify(second));
