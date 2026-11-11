// With three arguments the second must be a Blob. It throws before the third is looked at.
const form = new FormData();
let said = "no throw";
try {
  form.append("a", "b", undefined);
} catch (error) {
  said = error.name;
}
console.log(`${said} ${form.has("a")}`);
said = "no throw";
try {
  form.set("a", "b", undefined);
} catch (error) {
  said = error.name;
}
console.log(`${said} ${form.has("a")}`);
let converted = "not converted";
const name = {
  toString() {
    converted = "converted";
    return "x";
  },
};
try {
  form.append("a", "b", name);
} catch (error) {
  said = error.name;
}
console.log(`${said} ${converted} ${form.has("a")}`);
try {
  form.set("a", "b", name);
} catch (error) {
  said = error.name;
}
console.log(`${said} ${converted} ${form.has("a")}`);
form.append("a", new Blob(["x"]), name);
console.log(`${converted} ${form.get("a").name}`);
