const hidden = value => { try { throw value; } catch (caught) { return caught; } };
const table = hidden(new Map([["a", () => 1], ["b", () => 2]]));
console.log(table.get("b")(), [...table.values()].map(each => each()).join());
