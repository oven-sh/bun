// process.env[name], name given by the caller: what one read costs.
function isTruthy(name: string) { const v = process.env[name]; return v === "1" || v === "true"; }
const names = ["HOME", "PATH", "STRUCTS_A", "STRUCTS_B", "TERM", "NO_COLOR", "STRUCTS_C", "USER"];
const rounds = Number(process.argv[2] ?? 0);
let n = 0;
for (let r = 0; r < rounds; r++) for (let i = 0; i < 8; i++) if (isTruthy(names[i])) n++;
console.log(n);
