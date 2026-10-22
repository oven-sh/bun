// What the executor or a reaction of a subclass of Promise throws rejects the subclass instance.
function main() {
class Later extends Promise {}
const thrown = { reason: "from executor" };
const p = new Later(() => { throw thrown; });
p.catch((e) => console.log("caught", typeof e, e.reason));
const q = Later.resolve(1).then(() => { throw { reason: "from reaction" }; });
q.catch((e) => console.log("caught", typeof e, e.reason, q instanceof Later));
const r = new Later((resolve, reject) => reject({ reason: "rejected" }));
r.then(null, (e) => console.log("caught", e.reason));
async function waits() {
  try { await new Later(() => { throw { reason: "awaited" }; }); } catch (e) { console.log("caught", typeof e, e.reason); }
}
waits();
}
main();
