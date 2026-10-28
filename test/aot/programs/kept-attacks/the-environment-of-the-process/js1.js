// The environment of the process, one probe of many. It prints what plain Bun prints.
function write(out, record) {
  for (const key in record) {
    out.push(JSON.stringify(key), ":");
    out.push(JSON.stringify(record[key]) ?? "null");
  }
}
const records = JSON.parse('[{"alpha":"one","beta":2,"gamma":true,"delta":"four words in here"},{"epsilon":null,"zeta":"z","eta":7.5,"theta":"t"}]');
const rounds = Number(process.argv[2] ?? 100000);
let length = 0;
for (let i = 0; i < rounds; i++) { const out = []; write(out, records[i & 1]); length += out.length; }
console.log(length);
