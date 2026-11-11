export const read = () => KEY === undefined ? "early" : { late: KEY + "!" }[KEY];
const { call } = await import("./importer.mjs");
call("first", read);
var KEY = "late";
console.log(read());
