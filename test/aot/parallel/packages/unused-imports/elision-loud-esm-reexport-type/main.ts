export { T } from "loud_esm";
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
/* Output:
["loud_esm"]
*/
