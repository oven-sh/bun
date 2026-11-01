// Literals and targets of Object.assign that take objects the build cannot list: only read by name afterwards.
const lines = [];
const parse = text => JSON.parse(text);
const defaults = { host: "localhost", port: 80, secure: false, depth: 1 };
function spreadUnder(text) { return { ...defaults, ...parse(text) }; }
function assignUnder(text) { return Object.assign({}, defaults, parse(text)); }
function assignOver(text) { return Object.assign({}, parse(text), defaults); }
function spreadOver(text) { return { ...parse(text), ...defaults }; }
function membersInFront(text) { return { host: "h", port: 1, ...parse(text) }; }
function membersBehind(text) { return { ...parse(text), host: "h", port: 1 }; }
const texts = ["{}", '{"port":8080}', '{"port":"eighty","host":7}', '{"extra":1,"host":null}', '{"depth":1.5,"secure":"yes","more":{"a":1}}', '{"__proto__":{"inherited":1,"host":"from above"}}', '{"0":"zero","1":"one","port":2}', '{"depth":4,"secure":true,"port":3,"host":"other order"}', "null", '"text"', "[1,2]", "5"];
const kept = [];
for (const make of [spreadUnder, assignUnder, assignOver, spreadOver, membersInFront, membersBehind]) {
  for (const text of texts) {
    const made = make(text);
    kept.push(made);
    lines.push(make.name + " " + text + " " + [made.host, made.port, made.secure, made.depth, made.extra, made.inherited, made[0], made.more && made.more.a].map(String).join("|"));
  }
}
let sum = 0;
for (let round = 0; round < 3000; round++) {
  for (const made of kept) sum = (sum + String(made.host).length + String(made.port).length + (made.secure ? 1 : 0) + (typeof made.depth === "number" ? made.depth : 7)) | 0;
}
lines.push(String(sum));
console.log(lines.join("\n"));
