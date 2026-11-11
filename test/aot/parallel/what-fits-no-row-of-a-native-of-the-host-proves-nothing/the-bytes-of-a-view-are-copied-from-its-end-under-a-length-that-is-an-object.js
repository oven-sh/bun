// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: a call that is taken for one that throws gives the variable that takes its answer no type
let last = "none";
let asked = 0;
function tell() { console.log(typeof last, Buffer.isBuffer(last) ? "Buffer " + last.length : String(last), asked); }
tell();
last = Buffer.copyBytesFrom(new Uint8Array(2), 2, { valueOf() { asked++; return 1; } });
tell();
