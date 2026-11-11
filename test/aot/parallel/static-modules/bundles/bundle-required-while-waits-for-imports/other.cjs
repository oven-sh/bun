globalThis.hook = () => {
  try {
    return require("./bundle.mjs").run(1);
  } catch (error) {
    return error.constructor.name;
  }
};
