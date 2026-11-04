// Neither `Bun` nor `$` is written in this program: both names are put together while it runs. The build sees no use of the shell and leaves it out. What stands in its
// place says so when it is called. `typeof` and a read of a member can't say it. With `Bun.$` written anywhere in the program the shell is whole.
// Alone: what an executable leaves out goes by all that it holds
const never = process.argv.length > 99;
const glue = (...parts) => parts.join(never ? "x" : "");
const shell = globalThis[glue("B", "un")][glue("$", "")];
console.log(typeof shell, typeof shell.escape, Reflect.ownKeys(shell).length);
try {
  console.log((await shell`echo hi`.text()).trim());
} catch (error) {
  console.log(error.message.split(" because ")[0]);
}
/* Output:
function undefined 2
Bun.$ was not compiled into this executable
*/
