// `x <!--y` in a TypeScript file compares x with the negation of a decremented y. Plain Bun prints another output.
const x: any = 1;
let y: any = 2;
console.log(x <!--y, y);
console.log(x<!--y
, y);
/* Output:
false 1
false 0
*/
