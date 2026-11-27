// The name is the one that the property holds.
function declared() {}
const symbol = Symbol("described");
for (const held of [declared, declared.bind(null), new Proxy(declared, {}), class Declared { static name = "Stored"; }, { [symbol]() {} }[symbol], class {}, () => {}, Map]) {
  try {
    process.exitCode = held;
  } catch (error) {
    console.log(`${error.message}`);
  }
}
