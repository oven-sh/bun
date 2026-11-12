module.paths.push(require("node:path").join(__dirname, "..", "listed"));
module.exports = [JSON.parse(`"only"`), JSON.parse(`"both"`), JSON.parse(`"installed"`)].map(name => {
  try {
    return name + ": " + require(name).from;
  } catch (error) {
    return name + ": " + error.code;
  }
});
