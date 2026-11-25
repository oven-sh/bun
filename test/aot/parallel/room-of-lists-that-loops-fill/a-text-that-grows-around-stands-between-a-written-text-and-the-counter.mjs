function run(rows) { let g = ""; let c = 0; for (let r = 0; r < rows; r++) { g += "ab"; const out = []; for (let at = 0; at < 1000; at++) out.push("k" + g + at); c += out.length; } return g.length + ":" + c; }
console.log(run(JSON.parse("3")));
