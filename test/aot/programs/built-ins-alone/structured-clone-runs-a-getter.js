const source = {
  get value() {
    console.log("getter");
    return 1.5;
  },
};
console.log(structuredClone(source).value + 1);
