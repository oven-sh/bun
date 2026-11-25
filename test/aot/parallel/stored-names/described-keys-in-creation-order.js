// A key that Object.defineProperties creates stands in front of a field that is stored behind it, also behind an object with an element made by the same constructor.
function Client(given) { this.port = 80; Object.defineProperties(this, Object.getOwnPropertyDescriptors(given)); this.kind = typeof this.port + "/" + typeof this.host; Object.preventExtensions(this); }
const all = [];
for (let turn = 0; turn < 3; turn++) { all.length = 0; all.push(new Client({ port: 443 })); all.push(new Client({ 0: "zero", port: 2 })); all.push(new Client({ port: 443.5, host: undefined })); }
console.log("SAID", all.map(each => Object.entries(each).map(([key, value]) => key + "=" + typeof value).join()).join(" ; "));
