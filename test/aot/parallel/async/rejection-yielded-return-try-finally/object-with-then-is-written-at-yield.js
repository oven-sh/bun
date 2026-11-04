// An object with a then is written at the yield.
async function* inner() {
  return yield {
    then() {
      throw new Error("then throws");
    },
  };
}
async function* made() {
  try {
    if (yield* inner()) return "early";
  } finally {
    console.log("finally");
  }
}
const walk = made();
try {
  console.log(await walk.next(1));
} catch (error) {
  console.log(typeof error, String(error));
}
console.log(await walk.next(1));
