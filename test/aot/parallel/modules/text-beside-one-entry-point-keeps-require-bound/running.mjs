console.log("running begins");
new Function("name", "return import(name)")("node:path").then(names => console.log("import of node:path: fulfilled,", typeof names.join));
console.log("running ends");
export const ended = true;
