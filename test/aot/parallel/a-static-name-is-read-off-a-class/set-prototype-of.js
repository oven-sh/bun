// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: a static name that is taken for absent gives the variable that takes the read no other type than undefined
class Reader { constructor(text) { this.text = text; this.at = 0; } step() { this.at = this.at + 1; return this.at < this.text.length; } }
let last = "none";
function tell() { console.log(typeof last, typeof last === "function" ? "function" : String(last)); }
function anyOf(a, b) { return process.argv.length > 90 ? a : b; }
tell();
Object.setPrototypeOf(Reader, { extra: 7 });
last = Reader.extra;
tell();
