import { report } from "./reader.js";
const local = 1;
report("early", "function-expression");
export default (function () {});
report("late", "function-expression");
