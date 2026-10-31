import { report } from "./reader.js";
const local = 1;
report("early", "template-with-value");
export default `t${1}`;
report("late", "template-with-value");
