const seen = [
  module.laid,
  module.parent?.laid,
  this === module.exports,
  exports === module.exports,
  module.loaded,
  require("./child.cjs"),
];
Object.defineProperty(module, "exports", { enumerable: true, get: () => seen.join(" . ") });
