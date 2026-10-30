postMessage("loading");
let sum = 0;
for (let i = 0; i !== -1; i = (i + 1) | 0) sum = (sum + i) | 0;
postMessage("loaded " + sum);
