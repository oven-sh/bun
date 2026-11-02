import { report } from "./reader.js";
const local = 1;
report("early", "arrow");
export default () => 1;
report("late", "arrow");
