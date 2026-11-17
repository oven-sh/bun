// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: a belief about what a call on a built-in object enters shows first as a false proof about what the call gives
const bytes = Buffer.alloc(8);
let last = "none";
function tell() { console.log(typeof last, String(last), bytes.toString("latin1", 0, 2)); }
tell();
last = bytes.write(12, "latin1");
tell();
