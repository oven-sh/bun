// The order word lists the fields alone. A property that is no field shows in one bit of it, and has to come out in the text.
function row(id) { return { id, name: "r" + id }; }
const key = process.argv.length > 99 ? "name" : "extra";
const rows = [];
for (let i = 0; i < 4; ++i) rows.push(row(i));
rows[2][key] = true;
for (const each of rows) console.log(JSON.stringify(each));
