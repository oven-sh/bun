// COUNTER: TransitionsCachedForParsedNames >= 0
// A name twice in one object, an index among the names, __proto__ as a name: each leaves the quick road; first, second and third coming answer alike.
const texts = ['{"a":1,"b":2,"a":3}', '{"a":1,"0":2,"b":3}', '{"a":1,"__proto__":{"x":1},"b":2}', '{"":1,"a":2}'];
for (let round = 0; round < 3; round++) console.log(texts.map(text => { const made = JSON.parse(text); return Object.keys(made).join() + "=" + JSON.stringify(made) + (Object.getPrototypeOf(made) === Object.prototype); }).join(" "));
