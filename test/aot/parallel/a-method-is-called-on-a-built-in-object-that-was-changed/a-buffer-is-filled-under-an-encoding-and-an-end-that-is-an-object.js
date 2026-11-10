// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: a belief about what a call on a built-in object enters shows first as a false proof about what the call gives
const bytes = Buffer.alloc(4);
let last = 5;
let asked = 0;
function tell() { console.log(typeof last, Buffer.isBuffer(last) ? "Buffer " + last.toString("hex") : String(last), asked); }
tell();
last = bytes.fill("62", "hex", { valueOf() { asked++; return 2; } });
tell();
