// Where the receiver of a refused call is more than a chain of names, an executable names the method alone. `bun run` quotes the receiver as its transpiler prints it.
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
TypeError get is not a function. (In 'get()', 'get' is undefined)
TypeError get is not a function. (In 'get()', 'get' is undefined)
TypeError get is not a function. (In 'get()', 'get' is undefined)
TypeError get is not a function. (In 'get()', 'get' is undefined)
TypeError get is not a function. (In 'get()', 'get' is undefined)
TypeError get is not a function. (In 'get()', 'get' is undefined)
TypeError get is not a function. (In 'get()', 'get' is undefined)
TypeError get is not a function. (In 'get()', 'get' is undefined)
*/
