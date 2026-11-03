// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
console.log(Bun.peek(Promise.resolve(1)), Bun.peek.status(new Promise(() => {})), Bun.peek(2));
