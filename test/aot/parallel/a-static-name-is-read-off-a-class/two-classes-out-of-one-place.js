// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: a static name that is taken for absent gives the variable that takes the read no other type than undefined
function make() { return class { constructor(text) { this.text = text; } }; }
const Reader = make();
const Other = make();
let last = "none";
function tell() { console.log(typeof last, typeof last === "function" ? "function" : String(last)); }
function anyOf(a, b) { return process.argv.length > 90 ? a : b; }
tell();
Other.extra = 5;
Reader.extra = 7;
last = Reader.extra;
tell();
