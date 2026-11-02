function f(code) {
  switch (code) {
    case 1:
      return helper(code);
    case 2:
      function helper(n) {
        return n + 40;
      }
      return helper(0) + 1;
    default:
      return typeof helper;
  }
}
console.log(f(1), f(2), f(3));

/* Output:
41 41 function
*/
