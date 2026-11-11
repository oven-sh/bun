// Serializing runs toJSON() and getters of the value, and reading the headers runs their getters: what they change is read anew behind the call.
// STATISTIC: LiteralArgumentsScalarized >= 4
function local(status) {
  let n = 0;
  const made = Response.json({ toJSON() { n++; return 1; } }, { status, headers: { get a() { n += 10; return "b"; } } });
  return n + " " + made.status;
}
function localInALoop(status, turns) {
  let n = 0, told = "";
  for (let turn = 0; turn < turns; turn++) {
    const before = n;
    const made = Response.json({ toJSON() { n++; return turn; } }, { status, headers: { get a() { n += 10; return "b"; } } });
    told += before + ">" + n + ":" + made.status + " ";
  }
  return told + n;
}
let shared = 0;
function ofTheModule(status) {
  const before = shared;
  const made = Response.json({ get x() { shared += 100; return 1; } }, { status, headers: { get a() { shared += 1000; return "b"; } } });
  return before + ">" + shared + " " + made.status;
}
function field(holder, status) {
  const before = holder.count;
  const made = Response.json({ toJSON() { holder.count++; return 1; } }, { status: { valueOf() { holder.count += 10; return status; } }, statusText: { toString() { holder.count += 100; return "T"; } } });
  return before + ">" + holder.count + " " + made.status + made.statusText;
}
function list(items, status) {
  const before = items.length;
  const first = items[0];
  const made = Response.json({ toJSON() { items.push(1); items[0] = "changed"; return 1; } }, { status, headers: { get a() { items.push(2); return "b"; } } });
  return before + ">" + items.length + " " + first + ">" + items[0] + " " + made.status;
}
for (let turn = 0; turn < 3; turn++) console.log(local(200 + turn), "|", localInALoop(201, 3), "|", ofTheModule(202), "|", field({ count: turn }, 203), "|", list(["first"], 204));
