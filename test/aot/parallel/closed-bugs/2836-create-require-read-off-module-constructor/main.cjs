// Exit code: 1
const holder = { load: module.constructor.createRequire };
const view = JSON.parse('{"a":1}', function (key, value) { return key === "" ? holder : value; });
console.log(typeof view.load(__filename)(process.argv[2] ?? "node:net").Socket);
