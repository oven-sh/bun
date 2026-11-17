let n = 0;
process.binding("fs").statValues.forEach(() => { n++; });
process.binding("uv").getErrorMap().forEach(() => { n++; });
console.log(n > 36);
