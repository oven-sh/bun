// The first argument is proven a number, which none of the three takes. Each is written in JavaScript, and its own text says the TypeError.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
// STATISTIC: ImageFunctionsEmitted <= 12
function tell(attempt) {
  try {
    console.log(attempt());
  } catch (error) {
    console.log(error.name + ": " + error.message);
  }
}
tell(() => Reflect.has(1, "a"));
tell(() => Reflect.get(2, "a"));
tell(() => Reflect.apply(3, undefined, []));
