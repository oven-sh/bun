// STATISTIC: ImageFunctionsEmitted <= 20
const said = [];
process.once("exit", code => said.push("once " + code));
process.addListener("exit", code => said.push("added " + code));
process.prependListener("exit", code => said.push("first " + code));
process.prependOnceListener("exit", code => said.push("zeroth " + code));
process.on("exit", () => console.log(said.join(" | ")));
