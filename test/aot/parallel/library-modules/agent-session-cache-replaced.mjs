import https from "node:https";
const agent = new https.Agent();
console.log(typeof agent._getSession("constructor"));
agent._sessionCache.map = function () {};
const found = agent._getSession("constructor");
try {
  console.log(found ? found("return 6 * 7")() : "nothing is inherited");
} catch (error) {
  console.log(error.name);
}

/* Output:
function
EvalError
*/
