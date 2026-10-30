import { report } from "./reader.js";
const local = 1;
report("early", "class-expression-with-call");
export default (class { static n = Math.abs(1); });
report("late", "class-expression-with-call");
