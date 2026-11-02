globalThis.say ??= (...words) => console.log(words.join(" "));
globalThis.tell ??= (label, read) => {
  let text;
  try {
    const value = read();
    text = value === null ? "null" : typeof value === "object" || typeof value === "function" ? typeof value + "{" + Reflect.ownKeys(value).filter(key => typeof key === "string" && !["length", "name", "prototype", "arguments", "caller", "__esModule"].includes(key)).sort().join() + "}" : typeof value + ":" + String(value);
  } catch (error) {
    text = "throws " + (error && error.name);
  }
  console.log(label, text);
};
globalThis.atTheEnd ??= [];
