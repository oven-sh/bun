// other values that the host computes once
const p: any = process;
p[JSON.parse('"notAMember"')] = 1;
const seen: unknown[] = [];
const first = [process.stdout, process.versions, process.config, process.execArgv];
const look = () => seen.push(process.stdout === first[0], process.versions === first[1], process.config === first[2], process.execArgv === first[3]);
look();
look();
p[JSON.parse('"execArgv"')] = ["replaced"];
look();
seen.push(process.execArgv.join());
console.log(seen.join());
