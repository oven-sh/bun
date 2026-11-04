import "./second.mjs";
import defer * as whole from "./second.mjs";
let read;
try { read = whole.value; } catch (error) { read = error.name; }
export const seen = read;
