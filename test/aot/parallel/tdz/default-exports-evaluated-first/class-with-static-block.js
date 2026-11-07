import { report } from "./reader.js";
const local = 1;
report("early", "class-with-static-block");
export default class { static {} }
report("late", "class-with-static-block");
