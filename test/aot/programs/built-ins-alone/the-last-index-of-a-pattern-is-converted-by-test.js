const pattern = /a/y;
pattern.lastIndex = {
  valueOf() {
    console.log("valueOf");
    return 1;
  },
};
console.log(pattern.test("banana"), pattern.lastIndex + 1);
