const key = t => JSON.parse(JSON.stringify(t)), log = [];
function born(i) { return { id: i % 2 ? i : undefined, name: "n" + i, age: i }; }
function grow(row) { log.push("grow"); row[key("late")] = 1; delete row[key("age")]; return -1; }
function omit(row) { const { id = grow(row), ...rest } = row; return id + ":" + Object.keys(rest).join(); }
const n = JSON.parse("4"), lines = []; for (let i = 0; i < n; i++) lines.push(omit(born(i)));
console.log("SAID " + lines.join(" ") + " " + log.length);
