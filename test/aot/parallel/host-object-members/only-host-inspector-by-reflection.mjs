// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
function print(object, key) {
  try {
    console.log(String(object[key](2, {})));
  } catch (error) {
    console.log(error.constructor.name, error.message.startsWith("Cannot use "));
  }
}
const [custom] = Object.getOwnPropertySymbols(URLSearchParams.prototype).filter(
  symbol => symbol.description === "nodejs.util.inspect.custom",
);
print(new URLSearchParams("a=1"), custom);
const found = Reflect.ownKeys(ReadableStream.prototype).find(
  key => typeof key === "symbol" && key.description === "nodejs.util.inspect.custom",
);
print(new ReadableStream(), found);
console.log("goes on");
