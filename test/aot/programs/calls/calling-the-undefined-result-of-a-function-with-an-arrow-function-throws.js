function fuzzKeys(value) {
  try {
    keys = Reflect.ownKeys(value);
  } catch (error) {}
}
const told = (error) => 0;
try {
  console.log(fuzzKeys(told)(told));
} catch (error) {
  console.log(error.name);
}
