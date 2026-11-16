import { sep } from "./between2.mjs";
const safe = take => { try { return String(take()); } catch (error) { return error.constructor.name; } };
export const late = () => safe(() => sep);
