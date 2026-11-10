let Base = class First { who() { return "first"; } static kind() { return "First"; } };
const keep = Base;
if (process.argv.length > 0) Base = class Second { who() { return "second"; } static kind() { return "Second"; } };
class Below extends Base { own() { return this.who() + "!"; } }
console.log(new Below().own(), Below.kind(), Object.getPrototypeOf(Below) === Base, Object.getPrototypeOf(Below) === keep, new Below() instanceof keep, Object.getPrototypeOf(Below.prototype) === Base.prototype);
