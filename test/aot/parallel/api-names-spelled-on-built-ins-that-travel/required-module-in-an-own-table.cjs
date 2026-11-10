const table = { os: require("node:os"), dns: require("node:dns") };
const k = process.argv.length > 99 ? "none" : ["o", "s"].join("");
console.log(typeof table[k].cpus().length, typeof table.dns.getServers().length);
