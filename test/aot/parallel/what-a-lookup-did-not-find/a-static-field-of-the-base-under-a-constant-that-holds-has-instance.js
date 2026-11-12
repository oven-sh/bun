const key = Symbol.hasInstance;
class Base {
    static [key] = (value) => value % 2 === 0;
}
class Heir extends Base {}
function ask(value) {
    return value instanceof Heir;
}
console.log(ask(2), ask(3), ask(new Heir()));
