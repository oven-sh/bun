globalThis.mode = "at load";
let counter = 0;
export function bump() { counter++; }
const readMode = () => globalThis.mode;
const readCounter = () => counter;
export const seenAtLoad = /* @__PURE__ */ readMode();
export const counterAtLoad = /* @__PURE__ */ readCounter();
