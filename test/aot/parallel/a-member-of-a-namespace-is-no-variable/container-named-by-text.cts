// Evaluated text declares a variable named like the namespace. Plain Bun prints another output.
// Its transpiler leaves the parameter that holds the object of the namespace under the name of the namespace, so the variable of the text takes it. In an ordinary executable the bundler has given that parameter a name of its own, and this is what such an executable prints.
namespace Box {
  export var size = "member";
  export function peek(code: string): string { eval(code); return size; }
}
console.log(Box.peek("var Box = { size: 'other box' }"));
/* Output:
member
*/
