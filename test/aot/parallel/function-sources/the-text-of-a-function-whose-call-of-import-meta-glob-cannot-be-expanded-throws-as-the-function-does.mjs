// No type is erased here, so the text that is kept was the written text, byte for byte.
globalThis.pattern = "./things/" + process.argv.length + ".ts";
const ask = () => import.meta.glob(pattern);
const again = (0, eval)("(" + ask + ")");
for (const asked of [ask, again])
  try {
    asked();
  } catch (error) {
    console.log(error.name + ": " + error.message);
  }
