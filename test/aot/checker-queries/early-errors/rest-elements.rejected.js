// In a binding pattern a rest element is last and has no default. In an object pattern it is a name.
let [...a, b] = [];
let [...a = []] = [];
let [...a,] = [];
let { ...a, b } = {};
let { ...{ a } } = {};
let { ...[a] } = {};
function f([...a, b]) {}
