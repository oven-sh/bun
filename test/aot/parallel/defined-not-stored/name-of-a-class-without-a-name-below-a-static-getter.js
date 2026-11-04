class Above { static get name() { return "from the getter"; } }
const make = () => class extends Above {};
console.log(JSON.stringify(make().name), Object.hasOwn(make(), "name"));
