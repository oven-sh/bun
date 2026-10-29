// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import util from "node:util";
util.inspect.styles.number = "red";
util.inspect.styles.string = text => "<" + text + ">";
console.log(JSON.stringify(util.inspect([1, "a", /b/, null], { colors: true })));
util.inspect.styles = { number: "green" };
console.log(JSON.stringify(util.inspect([1, "a"], { colors: true })));
