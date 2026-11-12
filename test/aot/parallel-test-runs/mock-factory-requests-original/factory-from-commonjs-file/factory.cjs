exports.factory = () => {
  globalThis.ran = (globalThis.ran ?? "") + "factory,";
  return { ...jest.requireActual("./own"), value: "mock" };
};
