// `bun run` stores into the name and runs the loop: "body body behind".
function walk(list) {
  const seen = [];
  try {
    for (name of list) seen.push("body");
    let name;
    seen.push("behind");
  } catch (error) {
    seen.push(error.name);
  }
  return seen.join(" ");
}
console.log(walk([1, 2]));
/* Output:
ReferenceError
*/
