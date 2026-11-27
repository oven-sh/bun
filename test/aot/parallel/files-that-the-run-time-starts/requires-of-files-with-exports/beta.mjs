import { value as alpha } from "./alpha.mjs";
globalThis.log.push("beta runs over " + alpha);
export const value = alpha + 1;
export default "the default";
