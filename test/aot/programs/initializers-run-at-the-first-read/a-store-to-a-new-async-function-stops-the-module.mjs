// At the top level of a module: the binding that takes the result of a refused store is never read, and the module stops at the store all the same.
process.on("uncaughtException", error => {
  console.log("uncaught", error.name);
  console.log("reached", reached.join(","));
});
const reached = [];
reached.push("in front");
function fill() { const made = async function () {}; made.constructor = 2; return made; }
const table = fill();
reached.push("behind");
export const read = () => table;
