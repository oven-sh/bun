// An await in a try rejects twice.
async function keep(list, wanted) {
  try {
    return wanted(list[0]);
  } finally {
    await 0;
  }
}
const fails = (value) => {
  throw new Error("thrown at " + value);
};
for (const value of ["p", "q", "r"]) {
  try {
    console.log(await keep([value], fails));
  } catch (error) {
    console.log("caught", error.message);
  }
}
try {
  console.log(await keep(["s"], fails));
} catch (error) {
  console.log("caught", error.message);
}
try {
  console.log(await keep(["t"], fails));
} catch (error) {
  console.log("caught", error.message);
}
