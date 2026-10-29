// What the yielded promise rejects with is thrown at the yield. The return in the try and the return that return() asks for leave through one finally.
async function* made() {
  try {
    if (yield Promise.reject(new Error("broken"))) return "early";
  } finally {
  }
}
const walk = made();
try {
  console.log(await walk.next(1));
} catch (error) {
  console.log(typeof error, error instanceof Error, String(error));
}
console.log(await walk.next(2));
