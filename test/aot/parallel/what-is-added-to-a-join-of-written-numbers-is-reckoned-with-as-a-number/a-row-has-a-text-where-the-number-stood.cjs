
const rows = JSON.parse("[{\"id\":0,\"active\":true,\"score\":0.25},{\"id\":\"one\",\"active\":false,\"score\":1.5},{\"id\":2,\"active\":true,\"score\":3},{\"id\":3,\"active\":false,\"score\":\"x\"}]");

function run(turns) { let s = 0; for (let i = 0; i < turns; i++) { const m = rows[i & 3]; s += m.id + (m.active ? 1 : 0) + m.score; } return s; }
console.log(run(9), run(0));
