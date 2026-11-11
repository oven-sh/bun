function kindOf(name) {
  switch (name) {
    case "constructor":
      return 1;
    case "prototype":
      return 2;
    default:
      return 0;
  }
}
console.log(
  kindOf(process.argv.length > 100 ? "x" : "constructor"),
  "constructor" in {},
  Object.keys({ constructor: 1 }).join(),
  /constructor/.source,
);
