// compatibility.mdx, "Smaller differences". The transpiler of `bun run` drops the `0,`: "direct".
const direct = (0, () => {});
console.log(JSON.stringify(direct.name));
/* Output:
""
*/
