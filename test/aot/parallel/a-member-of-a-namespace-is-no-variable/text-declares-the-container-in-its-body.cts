// Text evaluated in the body of a namespace declares a variable named like the namespace. Plain Bun prints another output.
// There the variable is the parameter that holds the object of the namespace, so what the body exports afterwards lands on the object of the text. In an ordinary executable the bundler has given that parameter a name of its own, and this is what such an executable prints.
namespace Box {
  export var before = "before";
  eval("var Box = { marker: 'of the text' }");
  export var after = "after";
  export const keys = Object.keys(Box).join();
}
console.log(Object.keys(Box).join());
/* Output:
before,after,keys
*/
