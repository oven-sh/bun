// A require() whose path is computed finds what is in the executable, and plain data. It does not load an addon: process.dlopen does, and so does a require() of a constant path.
try {
  console.log("loaded", typeof require(process.env.ADDON!).names);
} catch (error) {
  console.log((error as { code?: string }).code, (error as Error).message.replace(process.env.ADDON!, "<addon>"));
}
export {};
