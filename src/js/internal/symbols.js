export default {
  // TODO: does this need to be exposed as Symbol.for?
  kIoDone: Symbol.for("kIoDone"),
  kCustomPromisifiedSymbol: Symbol.for("nodejs.util.promisify.custom"),
  writeStreamPathFastSymbol: Symbol.for("Bun.NodeWriteStreamFastPath"),
};
