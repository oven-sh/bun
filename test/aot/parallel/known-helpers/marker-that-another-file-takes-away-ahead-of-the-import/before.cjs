delete require("./stored.cjs").__esModule;
try {
  delete require("./defined.cjs").__esModule;
} catch (error) {
  console.log(error.constructor.name);
}
