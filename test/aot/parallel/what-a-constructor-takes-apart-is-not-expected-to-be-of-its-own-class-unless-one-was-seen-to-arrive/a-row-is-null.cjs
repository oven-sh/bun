class Member { constructor(row) { this.id = row.id; this.label = row.label; this.active = row.active; this.score = row.score; } }
const rows = JSON.parse("[{\"id\":0,\"label\":\"a\",\"active\":true,\"score\":0.25},{\"id\":1,\"label\":\"bb\",\"active\":false,\"score\":1.5},{\"id\":2,\"label\":\"c\",\"active\":true,\"score\":3},{\"id\":3,\"label\":\"dddd\",\"active\":false,\"score\":4.75}]");
function run(turns) { let s = 0; for (let i = 0; i < turns; i++) { const m = new Member(rows[i & 3]); s += m.id + m.label.length + (m.active ? 1 : 0) + m.score; } return s; }
rows[JSON.parse("3")] = null; function attempt(turns) { try { return run(turns); } catch (error) { return error.constructor.name + ": " + error.message; } }
console.log(run(0), attempt(2), attempt(9));
