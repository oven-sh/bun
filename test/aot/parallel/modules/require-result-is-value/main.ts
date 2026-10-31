import { change } from "./stored-later";
import { "module.exports" as live } from "./stored-later";
import whole = require("./stored-later");
import { change as changeFirst } from "./changed-first";
import { fill } from "./nothing-yet";
import constant = require("./constant");

const required = require("./stored-later");
console.log("before", (whole as any).a, required.a, live.a);
change();
console.log("after", (whole as any).a, required.a, require("./stored-later").a, live.a, whole === required, require("./stored-later") === required);

changeFirst();
console.log("changed first", require("./changed-first").a);

const early = require("./nothing-yet");
console.log("nothing yet", typeof early, early && Object.keys(early).join());
fill();
const late = require("./nothing-yet");
console.log("filled", typeof late, late && Object.keys(late).join(), late === early);

console.log("constant", (constant as any).a, (constant as any).other, require("./constant").a, require("./constant") === constant);
