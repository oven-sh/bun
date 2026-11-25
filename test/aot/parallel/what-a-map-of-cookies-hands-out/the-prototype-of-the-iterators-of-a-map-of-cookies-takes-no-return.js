// The prototype that the iterators of a map of cookies share is a built-in object: in an executable it takes no `return` and keeps its `next`. A name of another kind is let in.
const pairs = new Bun.CookieMap("a=1; b=2");
const steps = Object.getPrototypeOf(pairs.entries());
const attempt = (what, write) => {
  try {
    write();
    console.log(`${what}: laid`);
  } catch (error) {
    console.log(`${what}: refused ${error instanceof TypeError}`);
  }
};
attempt("return", () => {
  steps.return = function () {
    console.log("return runs");
    return {};
  };
});
attempt("next", () => {
  steps.next = () => ({ done: true });
});
attempt("another name", () => {
  steps.made$ = 1;
});
for (const [key] of pairs) {
  console.log(key);
  break;
}
console.log(`${[...pairs.keys()]} ${pairs.entries().made$}`);
/* Output:
return: refused true
next: refused true
another name: laid
a
a,b 1
*/
