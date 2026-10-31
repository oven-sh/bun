// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
function* numbers() {
  try {
    yield 1;
    yield 2;
  } catch (error) {
    yield error;
  }
}
const one = numbers();
console.log(one.next().value, one.throw("thrown").value, one.return("returned").value);
