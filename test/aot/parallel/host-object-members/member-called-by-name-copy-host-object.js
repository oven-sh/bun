// Copying an object of the host names no member. The read that names one through the copy does: the code behind it is in the executable, and the call answers what plain Bun answers.

const spread = { ...process };
console.log("spread", typeof spread.cwd(), typeof spread.hrtime.bigint(), spread.allowedNodeEnvironmentFlags instanceof Set);
const assigned = Object.assign({}, console);
assigned.log("assign", typeof assigned.Console);
const picked = {};
for (const key of Object.keys(Bun)) picked[key] = Bun[key];
console.log("walk", picked.inspect({ a: 1 }), picked.stringWidth("abc"));
