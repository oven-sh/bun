// A catch inside the finally looks at the reason.
async function* made() {
  try {
    try {
      if (yield Promise.reject(new Error("broken"))) return "early";
    } catch (error) {
      console.log(typeof error, error instanceof Error, error === undefined, String(error), error.message);
    }
  } finally {
  }
}
const walk = made();
console.log(await walk.next(1));
console.log(await walk.next(2));
