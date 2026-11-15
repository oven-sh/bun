// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
function work() {
  using numbers = [1].values();
  throw new Error("thrown by the program");
}
try {
  work();
} catch (error) {
  console.log(error.name, error.message);
}
