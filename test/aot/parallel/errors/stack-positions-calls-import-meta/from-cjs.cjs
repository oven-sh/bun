exports.run = function run() {
  const a = module.require("./c9.cjs");
  const b = module["require"]("./e9.mjs");
  // prettier-ignore
  const e = module
    .require("./c11.cjs");
  return [a, b, e];
};
