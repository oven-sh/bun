// Text that is evaluated in the initializer of a field asks `#name in this` for an `accessor` field that has no value yet. Plain Bun answers true, and so does compiled code in an executable. Text that an executable evaluates still answers false there: docs/compiler/compatibility.mdx#code-from-strings
const lines = [];
class Early {
  before = [eval("#gauge in this"), #gauge in this];
  accessor #gauge = 1;
  after = [eval("#gauge in this"), #gauge in this];
}
const early = new Early();
lines.push("before the value: " + JSON.stringify(early.before));
lines.push("after the value: " + JSON.stringify(early.after));
console.log(lines.join("\n"));
/* Output:
before the value: [false,true]
after the value: [true,true]
*/
