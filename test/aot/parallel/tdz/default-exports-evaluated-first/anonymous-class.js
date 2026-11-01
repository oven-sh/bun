import { report } from "./reader.js";
const local = 1;
report("early", "anonymous-class");
export default class {}
report("late", "anonymous-class");
