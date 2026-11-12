// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: a call that is taken for one that throws gives the variable that takes its answer no type
let last = "none";
function tell() { console.log(typeof last, Buffer.isBuffer(last) ? "Buffer " + last.length : String(last)); }
tell();
last = Buffer.concat([], null);
tell();
