function f() {
  switch (2) {
    case 1:
      function helper() {
        return "one";
      }
      return helper();
    case 2: {
      return helper() + "!";
    }
  }
}
console.log(f());

/* Output:
one!
*/
