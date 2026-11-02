import { report } from "./reader.js";
const local = 1;
report("early", "named-class");
export default class Named {}
report("late", "named-class");
