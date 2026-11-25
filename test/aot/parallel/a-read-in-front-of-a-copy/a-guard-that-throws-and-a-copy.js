const items = [];
function add(item) { if (!item.id) throw new Error("no id"); items.push({ ...item }); }
add({ id: 7 });
add({ id: "abc", owner: 3 });
console.log(items.length, items[0].id, items[1].id, items[1].owner);
