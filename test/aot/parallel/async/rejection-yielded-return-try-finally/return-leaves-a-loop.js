async function* made() {
  for (let turn = 0; turn < 2; turn++) {
    try {
      if (yield turn ? Promise.reject(new Error("broken " + turn)) : turn) continue;
      return "early";
    } finally {
      console.log("finally", turn);
    }
  }
  return "end";
}
const walk = made();
for (const sent of [1, 2, 3]) {
  try {
    console.log(JSON.stringify(await walk.next(sent)));
  } catch (error) {
    console.log(typeof error, String(error));
  }
}
