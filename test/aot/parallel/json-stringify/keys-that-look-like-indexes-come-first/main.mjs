// An index is listed in front of every name, ascending, whenever it was made. A number in print that is no index is a name like any other.
function made() { return { b: 1, 2: "two", a: 2, 0: "zero", "-1": "minus", "1.5": "fraction", "4294967295": "large" }; }
function late(id) { const o = { id, name: "n" }; o[7] = "seven"; o[3] = "three"; return o; }
for (let i = 0; i < 2; ++i) console.log(JSON.stringify(made()), JSON.stringify(late(i)));
