import sloppy from "./sloppy.cjs";
import strict from "./strict.cjs";

const why = " because built-in objects are read-only in a compiled executable";
for (const patches of [strict, sloppy])
  for (const line of Object.keys(patches)) {
    try {
      patches[line]();
      console.log("nothing is thrown");
    } catch (error) {
      const frame = String(error.stack)
        .split("\n")
        .find(frame => /(strict|sloppy)\.cjs/.test(frame));
      console.log(
        error.name,
        "|",
        error.message.slice(0, error.message.indexOf(why) + why.length),
        "|",
        /\.cjs:(\d+):/.exec(frame)?.[1] - 4 === Number(line),
      );
    }
  }
console.log(
  JSON.stringify([
    typeof Function.prototype.call$0,
    "should" in {},
    "red" in {},
    "last" in {},
    3 in [],
    function () {
      return "its own";
    }.call(),
    [...[1, 2]].length,
    Date.toString === Function.prototype.toString,
    typeof [].push,
    typeof Math.abs,
    Object.getPrototypeOf(Array.prototype) === Object.prototype,
  ]),
);

/* Output:
TypeError | Cannot assign to Function.prototype.call$0 because built-in objects are read-only in a compiled executable | true
TypeError | Cannot assign to Object.prototype.should because built-in objects are read-only in a compiled executable | true
TypeError | Cannot assign to Object.prototype.red because built-in objects are read-only in a compiled executable | true
TypeError | Cannot assign to Object.prototype.last because built-in objects are read-only in a compiled executable | true
TypeError | Cannot assign to Array.prototype[3] because built-in objects are read-only in a compiled executable | true
TypeError | Cannot assign to Function.prototype.call because built-in objects are read-only in a compiled executable | true
TypeError | Cannot assign to Function.prototype.call because built-in objects are read-only in a compiled executable | true
TypeError | Cannot assign to Array.prototype[Symbol(Symbol.iterator)] because built-in objects are read-only in a compiled executable | true
TypeError | Cannot assign to Date.toString because built-in objects are read-only in a compiled executable | true
TypeError | Cannot delete Function.prototype.call because built-in objects are read-only in a compiled executable | true
TypeError | Cannot delete Array.prototype.push because built-in objects are read-only in a compiled executable | true
TypeError | Cannot assign to Math because built-in objects are read-only in a compiled executable | true
TypeError | Cannot assign to Math because built-in objects are read-only in a compiled executable | true
TypeError | Cannot assign to Math because built-in objects are read-only in a compiled executable | true
TypeError | Cannot delete Math because built-in objects are read-only in a compiled executable | true
TypeError | Cannot change the prototype of Array.prototype because built-in objects are read-only in a compiled executable | true
TypeError | Cannot assign to Array.prototype.__proto__ because built-in objects are read-only in a compiled executable | true
TypeError | Cannot assign to Function.prototype.call$0 because built-in objects are read-only in a compiled executable | true
TypeError | Cannot assign to Object.prototype.should because built-in objects are read-only in a compiled executable | true
TypeError | Cannot assign to Object.prototype.red because built-in objects are read-only in a compiled executable | true
TypeError | Cannot assign to Object.prototype.last because built-in objects are read-only in a compiled executable | true
TypeError | Cannot assign to Array.prototype[3] because built-in objects are read-only in a compiled executable | true
TypeError | Cannot assign to Function.prototype.call because built-in objects are read-only in a compiled executable | true
TypeError | Cannot assign to Function.prototype.call because built-in objects are read-only in a compiled executable | true
TypeError | Cannot assign to Array.prototype[Symbol(Symbol.iterator)] because built-in objects are read-only in a compiled executable | true
TypeError | Cannot assign to Date.toString because built-in objects are read-only in a compiled executable | true
TypeError | Cannot delete Function.prototype.call because built-in objects are read-only in a compiled executable | true
TypeError | Cannot delete Array.prototype.push because built-in objects are read-only in a compiled executable | true
TypeError | Cannot assign to Math because built-in objects are read-only in a compiled executable | true
TypeError | Cannot assign to Math because built-in objects are read-only in a compiled executable | true
TypeError | Cannot assign to Math because built-in objects are read-only in a compiled executable | true
TypeError | Cannot delete Math because built-in objects are read-only in a compiled executable | true
TypeError | Cannot change the prototype of Array.prototype because built-in objects are read-only in a compiled executable | true
TypeError | Cannot assign to Array.prototype.__proto__ because built-in objects are read-only in a compiled executable | true
["undefined",false,false,false,false,"its own",2,true,"function","function",true]
*/
