import { get as own2 } from "./state.mjs";
export { get } from "./state.mjs";
export const again = () => own2();
const name = "barrel";
export const own = () => name;
