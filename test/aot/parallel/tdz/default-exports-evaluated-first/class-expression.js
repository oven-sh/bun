import { report } from "./reader.js";
const local = 1;
report("early", "class-expression");
export default (class {});
report("late", "class-expression");
