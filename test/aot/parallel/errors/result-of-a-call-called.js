// What a call returned is called and is no function: the call is quoted as Bun's transpiler prints it.
function make(x) {
  return { v: x };
}
class Box {}
const box = () => new Box();
const o = { m: () => 1, n: { k: () => null } };
let name = "n";
const tries = [
  () => make(1)(),
  () => make()(),
  () => box()(),
  () => o.m()(),
  () => o.n.k()(2, 3),
  () => o[name].k()(),
  () => make(make(1))(),
  () => make(1)(make(2)()),
  () => make(1)()(),
  () => make?.(1)(),
  () => make(1)?.(),
  () => make(...[1])(),
  () => make({ a: 1 }, [2], "s")(name),
  () => [make, make(3)()],
];
for (const attempt of tries) {
  try {
    attempt();
  } catch (error) {
    console.log(error.name, error.message);
  }
}
/* Output:
TypeError make(1) is not a function. (In 'make(1)()', 'make(1)' is an instance of Object)
TypeError make() is not a function. (In 'make()()', 'make()' is an instance of Object)
TypeError box() is not a function. (In 'box()()', 'box()' is an instance of Box)
TypeError o.m() is not a function. (In 'o.m()()', 'o.m()' is 1)
TypeError o.n.k() is not a function. (In 'o.n.k()(2, 3)', 'o.n.k()' is null)
TypeError o[name].k() is not a function. (In 'o[name].k()()', 'o[name].k()' is null)
TypeError make(make(1)) is not a function. (In 'make(make(1))()', 'make(make(1))' is an instance of Object)
TypeError make(2) is not a function. (In 'make(2)()', 'make(2)' is an instance of Object)
TypeError make(1) is not a function. (In 'make(1)()', 'make(1)' is an instance of Object)
TypeError make?.(1) is not a function. (In 'make?.(1)()', 'make?.(1)' is an instance of Object)
TypeError make(1) is not a function. (In 'make(1)?.()', 'make(1)' is an instance of Object)
TypeError make(...[1]) is not a function. (In 'make(...[1])()', 'make(...[1])' is an instance of Object)
TypeError make({ a: 1 }, [2], "s") is not a function. (In 'make({ a: 1 }, [2], "s")(name)', 'make({ a: 1 }, [2], "s")' is an instance of Object)
TypeError make(3) is not a function. (In 'make(3)()', 'make(3)' is an instance of Object)
*/
