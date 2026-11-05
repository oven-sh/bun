const show = (name, value) => console.log(name, JSON.stringify(value), Object.prototype.toString.call(value));
show("made for the file name", require("node:module").createRequire(__filename)("./made-for-the-file-name.txt"));
const load = require;
show("another name", load("./another-name.txt"));
show("require.call", require.call(null, "./require-call.txt"));
for (const name of ["commonjs"]) show("computed", require("./computed/" + name + ".txt"));
show("linked before", require("./linked-before.txt"));
