import { step } from "./helpers.mjs";
export default `${{ toString: () => String(step(2)) }}`.length;
