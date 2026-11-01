import { report } from "./reader.js";
const local = 1;
report("early", "name");
export default local;
report("late", "name");
