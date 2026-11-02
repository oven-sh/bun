let caught;
try {
  await Promise.reject(new RangeError("refused"));
} catch (error) {
  caught = error.message;
}
console.log("caught-rejection ran", caught);
export const name = "caught-rejection";
