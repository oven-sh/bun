// A control: nothing is thrown.
const holder = process.allowedNodeEnvironmentFlags;
let seen = 0;
for (const flag of holder) seen += typeof flag === "string" ? 1 : 0;
console.log(seen > 10, [...holder.keys()].length === seen, [...holder.entries()][0].length);
