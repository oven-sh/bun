// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: a belief about what a call on a built-in object enters shows first as a false proof about what the call gives
const bytes = Buffer.alloc(8);
let last = "none";
let asked = 0;
function tell() { console.log(typeof last, String(last), asked, bytes.toString("latin1", 0, 2)); }
tell();
last = bytes.write({ toString() { asked++; last = "asked"; return "ab"; } }, "latin1");
tell();
