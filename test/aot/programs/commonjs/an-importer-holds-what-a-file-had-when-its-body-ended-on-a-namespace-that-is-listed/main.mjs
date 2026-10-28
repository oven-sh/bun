// listed.cjs goes on storing under a name in a tick and a job that it queued while its body ran. Its namespace object, whose names are listed, shows what the file had when its body ended.
import * as listed from "./listed.cjs";

console.log(Object.keys(listed).join(), listed.steps);
setTimeout(() => console.log(listed.steps, require("./listed.cjs").steps));
