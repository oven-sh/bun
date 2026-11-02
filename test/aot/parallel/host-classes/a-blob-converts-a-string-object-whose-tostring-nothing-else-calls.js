// `slice`, `new Blob()` and `new File()` convert a String object with a toString of its own. Nothing else in the program calls
// that toString, and nothing uses the results of the calls. In the place of start or end of `slice`, a String object is the contentType.
let conversions = 0;
const boxed = Object.assign(new String("x/boxed"), {
  toString() {
    conversions++;
    return "x/own";
  },
});
const blob = new Blob(["abcd"]);

blob.slice(0, 2, boxed);
console.log(conversions);
blob.slice(boxed);
console.log(conversions);
blob.slice(0, boxed);
console.log(conversions);
new Blob(["a"], { type: boxed });
console.log(conversions);
new File(["a"], "name", { type: boxed });
console.log(conversions);
