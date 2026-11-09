const out = process.stdout;
function tell(text) { out.write(text); }
tell("through a variable\n");
console.log(out.writableLength >= 0);
