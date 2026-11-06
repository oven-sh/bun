// Url of node:url gives `this` twelve fields, and eight of their names are accessors of URL, whose prototype the objects of Url have nothing to do with.
// What an unrelated prototype has says nothing about them: the first store asks what is above the object, and the others create their fields where they stand.
// Alone: it counts calls into the run time, and what the library is compiled to goes by all that the executable holds
// COUNT: operation:operationAOTPutByIdAndCache <= 1
const { Url } = require("node:url");
const address = new URL("http://example.com:8080/a?b#c");
const made = new Url();
console.log(Object.keys(made).join());
console.log(address.host, made.host, address.hash, made.hash);
made.host = "other";
console.log(address.host, made.host);
