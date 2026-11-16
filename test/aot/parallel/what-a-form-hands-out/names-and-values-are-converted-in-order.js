// append and set convert the name, then the value or the file name; the others convert the name.
const said = [];
const says = text => ({
  toString() {
    said.push(text);
    return text;
  },
});
const form = new FormData();
form.append(says("name"), says("value"));
form.set(says("other"), new Blob(["x"]), says("file.txt"));
console.log(
  `${form.get(says("name"))} ${form.has(says("other"))} ${form.getAll(says("name")).length} ${form.get("other").name}`,
);
form.delete(says("name"));
console.log(`${said.join(" ")} | ${form.length}`);
try {
  form.append(
    {
      toString() {
        throw new RangeError("thrown by the name");
      },
    },
    says("never"),
  );
} catch (error) {
  console.log(`${error.name} ${error.message} ${said.includes("never")}`);
}
