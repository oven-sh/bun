import { report } from "./reader.js";
const local = 1;
report("early", "object");
export default {};
report("late", "object");
