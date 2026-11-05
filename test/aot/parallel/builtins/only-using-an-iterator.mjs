// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
{
  using numbers = [1, 2].values();
  console.log(numbers.next().value);
}
console.log("after");
