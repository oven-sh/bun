// The module early.js asks the namespace of late.js for the binding "late" while late.js has not run (the two import each other), and again when it has.
import "./late.js";
import { ways, before, direct, askAgain } from "./early.js";
const behind = askAgain();
ways.forEach(([name], index) => console.log(name, "|", before[index], direct[index], behind[index]));
