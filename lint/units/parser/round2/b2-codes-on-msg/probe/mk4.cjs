const fs = require("fs");
const inputs = [
  ["tsx", "let a = <b c=\"d\n"], ["tsx", "let a = <b c=\"d\ne"], ["tsx", "let a = <b c='d\\"], ["tsx", "<b c=\"d"], ["tsx", "let a = <b c=\"d\n\" />;"],
  ["jsx", "let a = <b c=\"d\n"], ["tsx", "let a = <b>{\"d\n}</b>"],
];
fs.writeFileSync("inputs4.json", JSON.stringify(inputs, null, 1));
fs.writeFileSync("inputs4.hex", inputs.map(([k, s], i) => `${i} ${k} ${Buffer.from(s, "utf8").toString("hex")}`).join("\n") + "\n");
