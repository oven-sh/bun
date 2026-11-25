// Nobody calls it by its name: a record holds it, and the record is asked under a key made at run time.
// STATISTIC: FunctionsLowered >= 300
function pick(from, key) {
  return from[key];
}
const tools = { pick };
const tool = tools[["pi", "ck"].join("")];
console.log(String(tool([3, 1, 2], ["to", "Sorted"].join("")).call([3, 1, 2])));
