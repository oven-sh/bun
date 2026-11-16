class Base {}
class Heir extends Base {}
const lay = new Function("holder", "Object.defineProperty(holder, Symbol.hasInstance, { value: (value) => value === 7 });");
function ask(value) {
    return value instanceof Heir;
}
console.log(ask(7), ask(new Heir()));
lay(Base);
console.log(ask(7), ask(new Heir()));
