const { read } = require("./reader.cjs");
const answers = [read(["./data", "json"].join(".")), read(["./note", "txt"].join("."))];
exports.early = () => answers.join(" | ");
