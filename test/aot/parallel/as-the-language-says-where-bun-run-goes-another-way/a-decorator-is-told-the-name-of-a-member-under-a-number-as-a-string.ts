// compatibility.mdx, "Smaller differences". `bun run` hands the literal on: "number 1". Node has no decorators to ask.
function mark(value: unknown, context: { name: string | symbol }) {
  console.log(typeof context.name, String(context.name));
}
class Shelf {
  @mark 1() {}
}
console.log(Object.getOwnPropertyNames(Shelf.prototype).join());
/* Output:
string 1
1,constructor
*/
