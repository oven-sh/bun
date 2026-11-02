import { report } from "./reader.js";
const local = 1;
report("early", "generator");
export default function* () {}
report("late", "generator");
