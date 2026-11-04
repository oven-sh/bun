const tools = { first() { return 1; }, get third() { return 3; } };
const copy = Object.assign({}, tools); console.log(copy.third, Object.keys(copy).map(name => typeof copy[name]).join());
