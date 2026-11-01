async function* made() {
  try {
    try {
      if (yield Promise.reject(new Error("broken"))) return "early";
    } finally {
      console.log("inner");
    }
  } finally {
    console.log("outer");
  }
}
const walk = made();
await walk.next(1).catch(error => console.log(typeof error, String(error)));
console.log(await walk.next(2));
