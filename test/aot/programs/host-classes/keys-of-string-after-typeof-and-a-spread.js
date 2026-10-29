// Asks for the type of String.raw, copies String with a spread and prints the own keys of String.
typeof String.raw;
const copy = { ...String };
console.log(Reflect.ownKeys(String).join());
