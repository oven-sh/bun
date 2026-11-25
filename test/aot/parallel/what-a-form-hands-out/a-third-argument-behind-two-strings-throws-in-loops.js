// With three arguments the second must be a Blob, also where a loop asks whether the method is FormData's own.
function setInLoop(form, filename) {
  let told = "";
  for (let i = 0; i < 2; i++) {
    try {
      form.set("k", "a", filename);
      told += "set ";
    } catch (error) {
      told += error.name + " ";
    }
  }
  return told + form.has("k");
}
function appendInLoop(form) {
  let told = "";
  for (let i = 0; i < 2; i++) {
    try {
      told += typeof form.append("k", "a", "b") + " ";
    } catch (error) {
      told += error.name + " ";
    }
  }
  return told + form.has("k");
}
function setUnknownInLoop(form, values, filename) {
  let told = "";
  for (const value of values) {
    try {
      form.set("k", value, filename);
      told += "set ";
    } catch (error) {
      told += error.name + " ";
    }
  }
  return told + form.has("k");
}
function setTwoInLoop(form, values) {
  let told = "";
  for (const value of values) {
    try {
      form.set("k", value);
      told += String(form.get("k")) + " ";
    } catch (error) {
      told += error.name + " ";
    }
  }
  return told;
}
let converted = 0;
const name = { toString() { converted++; return "x"; } };
console.log(setInLoop(new FormData(), "b"), setInLoop(new FormData(), undefined), setInLoop(new FormData(), name), converted);
console.log(appendInLoop(new FormData()));
console.log(setUnknownInLoop(new FormData(), ["a", 1, null, {}], "b"), setUnknownInLoop(new FormData(), [new Blob(["x"])], name), converted);
console.log(setTwoInLoop(new FormData(), ["a", 1, null, undefined, { toString() { return "o"; } }]));
