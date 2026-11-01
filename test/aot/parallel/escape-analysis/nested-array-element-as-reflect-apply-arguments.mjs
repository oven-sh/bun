// A closure passes an element of a nested array literal to Reflect.apply as the argument list, in a loop, and the
// built-in that is called throws for some of the lists.
const names = [];
function attempt(run) {
  try {
    run();
  } catch (error) {
    names.push(error.name);
  }
}
const rows = [[Symbol("s")], [""], []];
for (let i = 0; i < 40; i++) for (const row of rows) attempt(() => Reflect.apply(atob, globalThis, row));
console.log(names.length, names[0], names[79]);
