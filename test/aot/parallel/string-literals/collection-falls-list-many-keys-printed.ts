// A record is parsed from a text with 65,534 more keys than its type names, and the number of its keys is printed. So much is allocated that a collection falls while the objects that printing makes are alive,
// and some of their fields hold one of a few texts that no code of the program reads.
// Env: BUN_JSC_validateAOTRuntime=1
const members: string[] = [];
for (let i = 0; i < 65534; i++) members.push('"k' + i + '":' + i);
type Row = { first: number };
console.log(Object.keys(JSON.parse('{"first":0,' + members.join(",") + "}") as Row).length);
