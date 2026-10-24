// `bun run` quotes the source in some of these messages, an executable does not (docs/bundler/aot-compatibility.mdx).
const describe = error => error.name + ": " + error.message.replace(/ \(evaluating '.*'\)$/, "");

for (const run of [
  () => Object.getOwnPropertyNames(undefined),
  () => Object.getOwnPropertyNames(null),
  () => Object.keys(null),
  () => Object.keys(undefined),
  () => Object.entries(undefined),
  () => Object.values(null),
  () => Object.getOwnPropertySymbols(undefined),
  () => Object.getPrototypeOf(null),
  () => Object.getOwnPropertyDescriptors(undefined),
  () => Object.assign(null, { a: 1 }),
]) {
  try {
    console.log("returned", run());
  } catch (error) {
    console.log(describe(error));
  }
}

try {
  console.log(Object.getOwnPropertyNames(undefined));
} catch (error) {
  console.log(describe(error));
}
try {
  console.log(Object.keys(null));
} catch (error) {
  console.log(describe(error));
}
try {
  console.log(Object.entries(undefined));
} catch (error) {
  console.log(describe(error));
}

function names(value) {
  return Object.getOwnPropertyNames(value);
}
try {
  console.log(names(undefined));
} catch (error) {
  console.log(describe(error));
}
console.log(names({ a: 1, b: 2 }).join());
