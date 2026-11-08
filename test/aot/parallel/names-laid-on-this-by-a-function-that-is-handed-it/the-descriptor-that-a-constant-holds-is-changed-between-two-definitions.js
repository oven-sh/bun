const out = [];
const shared = { value: 0, enumerable: false, writable: false };
function lay(target, value) { shared.value = value; Object.defineProperty(target, "mark", shared); }
function Row(value, open) { if (open) { shared.enumerable = true; shared.writable = true; shared.configurable = true; } lay(this, value); shared.enumerable = false; shared.writable = false; delete shared.configurable; this.own = value; }
const show = (o) => Object.keys(o).join() + "|" + JSON.stringify(Object.getOwnPropertyDescriptor(o, "mark"));
const rows = []; for (let i = 0; i < 200; i++) rows.push(new Row(i, i % 3 === 0));
out.push(show(rows[0]), show(rows[1]), show(rows[198]), show(rows[199]));
const attempt = (deed) => { try { return String(deed()); } catch (e) { return e.constructor.name; } };
out.push(attempt(() => (rows[0].mark = "new")), attempt(() => (rows[1].mark = "new")), String(rows[0].mark), String(rows[1].mark));
out.push(attempt(() => delete rows[3].mark), attempt(() => delete rows[4].mark), show(rows[3]), show(rows[4]));
let sum = 0; for (const row of rows) sum += row.mark === undefined ? 1000 : typeof row.mark === "number" ? row.mark : 5; out.push(String(sum));
console.log(out.join("\n"));
