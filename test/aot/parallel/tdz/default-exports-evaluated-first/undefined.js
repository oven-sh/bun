import { report } from "./reader.js";
const local = 1;
report("early", "undefined");
export default undefined;
report("late", "undefined");
