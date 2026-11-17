// The Function constructor comes out of code of the library under the name `constructor`, and runs the text, as in `bun <file>`: out of the session cache of an https.Agent, once that is a function.
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

