const show = (name, ...values) => console.log(name, ...values.map(value => JSON.stringify(value)));
const atRunTime = name => process.argv[9] ?? name;
show("in a module", require("./in-a-module.txt"), import.meta.require(atRunTime("./in-a-module.txt")), require("./in-a-module.txt"));
