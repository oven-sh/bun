// Prints the names of functions and classes without a name that are assigned to a target in parentheses. By the language such a target gives no name. Plain Bun prints another output.
// Its transpiler prints the target without the parentheses, so plain Bun says "InParentheses", "InParenthesesInList", "InNamespace", "made", "Undecorated".
const told: string[] = [];
function on(value: any, context: any) {
  told.push(String(context.name));
  return value;
}
let InParentheses: any, InParenthesesInList: any;
(InParentheses) = @on class {};
[(InParenthesesInList) = @on class {}] = [] as any[];
namespace N {
  export let InNamespace: any;
  [(InNamespace) = @on class {}] = [] as any[];
}
let made: any, Undecorated: any;
(made) = function () {};
(Undecorated) = class {};
const names = (...values: any[]) => JSON.stringify(values.map(value => value.name));
console.log(names(InParentheses, InParenthesesInList, N.InNamespace, made, Undecorated));
console.log(JSON.stringify(told));
/* Output:
["","","","",""]
["","",""]
*/
