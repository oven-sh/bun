// compatibility.mdx, "Smaller differences". `bun run` stores into the name and runs the loop: "body behind".
function walk(holder) {
  const seen = [];
  try {
    for (name in holder) seen.push("body");
    let name;
    seen.push("behind");
  } catch (error) {
    seen.push(error.name);
  }
  return seen.join(" ");
}
console.log(walk({ a: 1 }));
/* Output:
ReferenceError
*/
