function f(code) {
  switch (code) {
    case 1:
      function helper() {
        return "first";
      }
      return helper();
    case 2:
      function helper() {
        return "second";
      }
      return helper();
  }
}
console.log(f(1), f(2));

/* Output:
second second
*/
