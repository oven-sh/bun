import { report } from "./reader.js";
const local = 1;
report("early", "big-int");
export default 5n;
report("late", "big-int");
