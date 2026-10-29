import { report } from "./reader.js";
const local = 1;
report("early", "anonymous-function");
export default function () {}
report("late", "anonymous-function");
