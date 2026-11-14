import kiln from "kiln";
globalThis.secondRan = (globalThis.secondRan ?? 0) + 1;
export const second = () => kiln.fire();
