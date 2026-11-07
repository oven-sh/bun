// compatibility.mdx, "Smaller differences". `bun run` lists "b,a 2".
const made = {
  get a() {
    return 1;
  },
  set a(value) {},
  b: 1,
  get a() {
    return 2;
  },
};
console.log(Object.keys(made).join(), made.a);
/* Output:
a,b 2
*/
