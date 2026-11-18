see("enters before it enters");
als.enterWith("A");
see("enters behind enterWith");
export function then(resolve) {
  see("then of enters");
  resolve("what then() hands on");
}
