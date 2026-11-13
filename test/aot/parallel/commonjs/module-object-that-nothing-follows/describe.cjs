const nameOf = it => it.id.split(/[\\/]/).pop();
module.exports = it => [nameOf(it), it.parent === null ? "null" : nameOf(it.parent), it.children.map(nameOf).join("+")].join(" ");
