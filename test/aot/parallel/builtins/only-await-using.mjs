// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
{
  await using held = {
    async [Symbol.asyncDispose]() {
      console.log("disposed");
    },
  };
  console.log("inside");
}
