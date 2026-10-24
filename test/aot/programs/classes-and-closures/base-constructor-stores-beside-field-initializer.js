// A base class with a field initializer stores another field in its constructor, and `this` is an instance of a subclass with a field of its own.
class Context { env = {}; constructor(request) { this.request = request; } }
class Wider extends Context { extra = []; }
const wide = new Wider(1);
console.log(JSON.stringify(wide), Object.keys(wide).join(), wide.request, JSON.stringify(new Context(2)));
