// The reason is a number and numbers are sent.
async function* made(flag) {
  let total = 0;
  try {
    total += yield Promise.reject(1.5);
    if (flag) return total;
  } finally {
    console.log("finally", total);
  }
  return total;
}
for (const flag of [false, true]) {
  const walk = made(flag);
  try {
    console.log(await walk.next(1));
  } catch (error) {
    console.log(typeof error, error);
  }
  console.log(await walk.next(2));
}
