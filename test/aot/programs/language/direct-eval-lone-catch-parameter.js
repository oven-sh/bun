// The parameter of catch (e) is the only binding the text of a direct eval can see: every other name is looked up on the global object.
export {};

try {
  throw 1;
} catch (e) {
  console.log(eval("e += 1; [e, typeof missing, Math.max(e, 1)]"), e);
  try {
    eval("missing");
  } catch (error) {
    console.log(error.name);
  }
}
