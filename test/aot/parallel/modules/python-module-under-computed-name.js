// A name that the build does not know is refused when the program asks for it.
const name = "python:" + ["js", "on"].join("");
try {
  await import(name);
  console.log("imported");
} catch (error) {
  console.log(error.constructor.name, error.message);
}
/* Output:
TypeError Python cannot be used in a program that was compiled ahead of time
*/
