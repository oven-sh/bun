class Root {}
class Base extends Root {}
class Heir extends Base {}
const lay = new Function("holder", "Object.defineProperty(holder, Symbol.hasInstance, { value: (value) => value === 7 });");
function ask(value) {
    return value instanceof Heir;
}
console.log(ask(7), ask(new Heir()));
lay(Root);
console.log(ask(7), ask(new Heir()));
