// At the end of the block `using` calls Iterator.prototype[Symbol.dispose], which is text of the library and which nothing here names.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
// STATISTIC: ImageFunctionsEmitted <= 8
{
  using numbers = [1, 2].values();
  console.log(numbers.next().value);
}
console.log("after");
