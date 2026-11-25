function helper(n) { return n + helper.step; }
Object.defineProperty(helper, "step", { value: 2 });
function put(value) { helper.step = value; return helper.step; }
let said = 0; for (let turn = 0; turn < 3000; turn++) { said = (said + helper(turn) + put(turn)) % 1000003; }
console.log(said, helper.step);
