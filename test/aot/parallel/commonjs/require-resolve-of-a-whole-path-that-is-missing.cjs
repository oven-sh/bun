// The error names what the program asked for: the whole path.
const tell = load => {
  try {
    return load();
  } catch (error) {
    return `${error.constructor.name} ${error.code} ${error.message.split("\n")[0].replaceAll(__dirname, "<here>")}`;
  }
};
console.log(tell(() => require.resolve(__dirname + "/none.cjs")));
console.log(tell(() => require.resolve("./none.cjs")));
console.log(tell(() => require(__dirname + "/none.cjs")));
console.log(tell(() => require("./none.cjs")));
