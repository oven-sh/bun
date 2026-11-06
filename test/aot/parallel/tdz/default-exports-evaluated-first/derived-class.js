import { report } from "./reader.js";
const local = 1;
report("early", "derived-class");
export default class extends Object {}
report("late", "derived-class");
