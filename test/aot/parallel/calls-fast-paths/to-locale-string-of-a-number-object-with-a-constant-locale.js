// `new Number(5).toLocaleString("en-US")`: the function takes the number out of the object. A call with a constant locale is written from a
// pattern made at build time, and a pattern is written from a number: on the object the build stopped with an internal compiler error.
class Count extends Number {}
const wrapped = new Number(1234567.891);
const counted = new Count(1234.5);
console.log(wrapped.toLocaleString("en-US"), wrapped.toLocaleString("de-DE"));
console.log(Number.prototype.toLocaleString.call(wrapped, "en-US"), Number.prototype.toLocaleString.call(new Number(5), "en-US"));
console.log(counted.toLocaleString("en-US"), new Count(-0.5).toLocaleString("en-US", { style: "percent" }));
console.log(Object(7000).toLocaleString("en-US"));

function written(value) {
  return value.toLocaleString("en-US");
}
console.log(written(wrapped), written(counted), written(1234567.891), written(12));

// Nothing reads the text.
new Number(5).toLocaleString("en-US");
