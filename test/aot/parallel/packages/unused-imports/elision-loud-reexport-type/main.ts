export { T } from "loud";
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
/* Output:
["loud"]
*/
