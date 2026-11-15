// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: a belief about what a call on a built-in object enters shows first as a false proof about what the call gives
const bytes = Buffer.alloc(4);
let last = "none";
function tell() { console.log(typeof last, Buffer.isBuffer(last) ? "Buffer " + last.toString("hex") : String(last)); }
tell();
last = bytes.fill("a", undefined, null);
tell();
