import { h, setH } from "./dynamic-a.js";
const was = h();
setH("set");
export const seen = was + h;
