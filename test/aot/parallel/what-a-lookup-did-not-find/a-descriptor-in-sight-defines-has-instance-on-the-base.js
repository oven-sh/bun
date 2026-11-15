class Base {}
class Heir extends Base {}
function ask(value) {
    return value instanceof Heir;
}
console.log(ask(7), ask(new Heir()));
Object.defineProperty(Base, Symbol.hasInstance, { value: (value) => value === 7 });
console.log(ask(7), ask(new Heir()));
