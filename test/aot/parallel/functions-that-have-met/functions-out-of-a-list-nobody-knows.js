const hidden = value => { try { throw value; } catch (caught) { return caught; } };
const list = hidden([() => "first", () => "second"]);
console.log(list[JSON.parse("1")](), list.map(each => each()).join());
