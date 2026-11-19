class Member { constructor(row) { this.id = row.id; this.label = row.label; this.active = row.active; this.score = row.score; } }
const rows = JSON.parse("[{\"id\":0,\"label\":\"a\",\"active\":true,\"score\":0.25},{\"id\":1,\"label\":\"bb\",\"active\":false,\"score\":1.5},{\"id\":2,\"label\":\"c\",\"active\":true,\"score\":3},{\"id\":3,\"label\":\"dddd\",\"active\":false,\"score\":4.75}]");
function run(turns) { let s = 0; for (let i = 0; i < turns; i++) { const m = new Member(rows[i & 3]); s += m.id + m.label.length + (m.active ? 1 : 0) + m.score; } return s; }
let asked = 0; Object.defineProperty(rows[1], "score", { get() { asked++; return asked; } }); console.log(run(9), run(0), asked);
