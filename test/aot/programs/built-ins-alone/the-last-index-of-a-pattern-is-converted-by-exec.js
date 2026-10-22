const pattern = /a/g;
pattern.lastIndex = {
  valueOf() {
    console.log("valueOf");
    return 2;
  },
};
console.log(pattern.exec("banana").index + 1, pattern.lastIndex + 1);
