async function* made() {
  try {
    if (yield yield yield Promise.resolve(5)) return "early";
  } finally {
    console.log("finally");
  }
}
const walk = made();
for (const sent of [1, 2, 3, 4, 5]) console.log(JSON.stringify(await walk.next(sent)));
const other = made();
console.log(JSON.stringify(await other.next(1)));
console.log(JSON.stringify(await other.next(Promise.reject(new Error("sent in"))).catch(error => String(error))));
console.log(JSON.stringify(await other.next(3)));
