const o = Object.groupBy([], () => "group");
function change(x) { try { Object.defineProperty(x, "added", { get() { return 7; } }); } catch (e) { console.log(e.name); } }
change(o);
console.log(o.added, Object.getOwnPropertyNames(o).join());
