class Holder {
  static async *made() {
    try {
      try {
        if (yield Promise.reject(new Error("broken 17"))) return "returned early";
      } finally {
      }
    } finally {
    }
  }
}
const walk = Holder.made(1, 2, 3);
try {
  await walk.next(1);
} catch (error) {
  console.log(String(error));
}
