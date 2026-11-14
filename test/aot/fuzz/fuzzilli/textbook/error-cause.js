function read(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error("unreadable", { cause: error });
  }
}
function tried(text) {
  try {
    return typeof read(text);
  } catch (error) {
    return error.message + " by " + error.cause.name;
  }
}
console.log(tried("{}"), tried("{"));
