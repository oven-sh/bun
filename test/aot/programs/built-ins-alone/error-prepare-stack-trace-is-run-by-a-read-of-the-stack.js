Error.prepareStackTrace = (error, sites) => {
  console.log("prepare", error instanceof Error, Array.isArray(sites));
  return 1.5;
};
const stack = new Error("failed").stack;
console.log(typeof stack, stack + 1);
