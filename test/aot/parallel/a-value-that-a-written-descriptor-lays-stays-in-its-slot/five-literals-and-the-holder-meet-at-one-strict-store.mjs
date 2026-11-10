// COUNTER: FieldsEvictedByRedefinition = 1
function double(n) { return (n * 2) | 0; }
function triple(n) { return (n * 3) | 0; }
const tools = {};
const all = [{ scale: double, a: 1 }, { scale: double, b: 1 }, { scale: double, c: 1 }, { scale: double, d: 1 }, { scale: double, e: 1 }, tools];
Object.defineProperty(tools, "scale", { value: double });
function use(turn) { let sum = 0; for (let i = 0; i < 50; i++) sum = (sum + tools.scale(i + turn)) | 0; return sum; }
function put(holder, value) { try { holder.scale = value; } catch (error) { return error.name; } return holder.scale === value ? "taken" : "dropped"; }
let said = 0, told = "";
for (let turn = 0; turn < 400; turn++) {
  if (turn % 100 === 99) { told = ""; for (const each of all) told += put(each, triple) + ","; }
  said = (said + use(turn)) % 1000003;
}
console.log("SAID SUM " + said);
console.log("SAID STORE " + told);
console.log("SAID SAME " + (tools.scale === double));
