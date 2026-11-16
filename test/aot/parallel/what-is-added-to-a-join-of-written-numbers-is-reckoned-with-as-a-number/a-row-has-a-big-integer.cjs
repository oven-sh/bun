
const rows = JSON.parse("[{\"id\":0,\"active\":true,\"score\":0.25},{\"id\":1,\"active\":false,\"score\":1.5},{\"id\":2,\"active\":true,\"score\":3},{\"id\":3,\"active\":false,\"score\":4.75}]");
rows[2].id = 5n;
function run(turns) { let s = 0; for (let i = 0; i < turns; i++) { const m = rows[i & 3]; s += m.id + (m.active ? 1 : 0) + m.score; } return s; }
function attempt(turns) { try { return run(turns); } catch (error) { return error.constructor.name + ": " + error.message; } }
console.log(run(0), attempt(2), attempt(9));
