// Flags: --aot-disable=pass:RemoveTrivialParameters
function pick(a, b, out) {
  if (a === b) {
    out.push(a);
    out.push(b);
  }
}

function pickGet(value, out) {
  pick(value, "get", out);
}

const inputs = JSON.parse(process.env.INPUTS ?? '["get", 3, "put"]');
const out = [];
for (const input of inputs) pickGet(input, out);
pick(1, null, out);
pick(null, null, out);
console.log(out.length, out.join());
