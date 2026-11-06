// Where the method of a refused call is named in brackets, or its receiver is a list written on the spot, an executable names the method alone. `bun run` quotes the receiver as its transpiler prints it.
function Late(z) {
  this.z = z;
}
function make() {
  return new Late(2);
}
class C {}
const tries = [
  () => new Late(1).get(),
  () => make().get(),
  () => new C().get(),
  () => new Late(1).z.get(),
  () => new Late(1)["get"](),
  () => [1].get(),
  () => ({ a: 1 }).get(),
  () => make().z.toFixed().get(1, 2),
];
for (const attempt of tries) {
  try {
    attempt();
  } catch (error) {
    console.log(error.name, error.message);
  }
}
/* Output:
TypeError new Late(1).get is not a function. (In 'new Late(1).get()', 'new Late(1).get' is undefined)
TypeError make().get is not a function. (In 'make().get()', 'make().get' is undefined)
TypeError new C().get is not a function. (In 'new C().get()', 'new C().get' is undefined)
TypeError new Late(1).z.get is not a function. (In 'new Late(1).z.get()', 'new Late(1).z.get' is undefined)
TypeError get is not a function. (In 'get()', 'get' is undefined)
TypeError get is not a function. (In 'get()', 'get' is undefined)
TypeError ({ a: 1 }).get is not a function. (In '({ a: 1 }).get()', '({ a: 1 }).get' is undefined)
TypeError make().z.toFixed().get is not a function. (In 'make().z.toFixed().get(1, 2)', 'make().z.toFixed().get' is undefined)
*/
