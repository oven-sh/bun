import { report } from "./reader.js";
const local = 1;
report("early", "async-function");
export default async function named() {}
report("late", "async-function");
