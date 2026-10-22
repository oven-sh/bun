const pattern = /a/y;
pattern.lastIndex = {
  valueOf() {
    console.log("valueOf");
    return 1;
  },
};
console.log("banana".replace(pattern, "-"));
