// The class above is a function that cannot be constructed, so the definition of the class throws and the construction behind it is never reached.
function belowTheSecondOperand(resolve, reject, nothing) {
  class Below extends reject {}
  const made = new Below();
  return made;
}
new Promise(belowTheSecondOperand).catch(e => console.log("rejected", e.constructor.name, e.message));

function below(parent) {
  class Below extends parent {}
  return new Below();
}
for (const parent of [
  Math.max,
  () => 1,
  async function () {},
  function* () {},
  { method() {} }.method,
  Symbol.iterator,
  5,
  undefined,
]) {
  try {
    console.log(typeof below(parent));
  } catch (e) {
    console.log(e.constructor.name, e.message);
  }
}
function belowMax() {
  class Below extends Math.max {}
  return new Below();
}
try {
  console.log(typeof belowMax());
} catch (e) {
  console.log(e.constructor.name, e.message);
}
