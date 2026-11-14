// `new Blob()` and `new File()` convert the `type` of their options to a string, and `slice` converts its contentType.
// The conversion runs the code of an object, also in a call whose result nothing uses.
let conversions = 0;
const type = {
  toString() {
    conversions++;
    return "x/converted";
  },
};
const blob = new Blob(["abcd"]);

console.log(new Blob(["a"], { type }).type, conversions);
console.log(new File(["a"], "name", { type }).type, conversions);
console.log(blob.slice(0, 2, type).type, conversions);

new Blob(["a"], { type });
console.log(conversions);
blob.slice(0, 2, type);
console.log(conversions);

// A string in the place of start is the contentType, and the operand after it is not read.
console.log(blob.slice("a/b", 1, type).type, conversions);
console.log(blob.slice(0, 2).type === "", blob.slice(0, 2, "A/B").type, blob.slice(0, 2, 1).type);
console.log(blob.slice(0, 2, null).type, blob.slice(0, 2, undefined).type === "");

const options = {
  reads: 0,
  get type() {
    this.reads++;
    return ["x/from-a-getter"];
  },
};
console.log(new Blob(["a"], options).type, options.reads);

for (const value of [Symbol("type"), Object.create(null)]) {
  try {
    blob.slice(0, 1, value);
    console.log("slice did not throw");
  } catch (error) {
    console.log(error instanceof TypeError, conversions);
  }
  try {
    new Blob(["a"], { type: value });
    console.log("new Blob did not throw");
  } catch (error) {
    console.log(error instanceof TypeError, conversions);
  }
}
