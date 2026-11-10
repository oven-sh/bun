// What the turns laid out have summed and counted is what the handler finds when something throws behind the loop.
function add(n) {
  let total = 0, i = 0;
  try {
    for (i = 0; i < n; i++) total = (total + i * 3) | 0;
    if (total > 100) throw new Error("large");
  } catch (error) {
    return error.message + ":" + total + ":" + i;
  }
  return "small:" + total + ":" + i;
}
console.log([0, 1, 7, 8, 9, 16, 17, 100, 1001].map(add).join(" "));
