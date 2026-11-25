class Base {
    static {
        Reflect.defineProperty(this, Symbol.hasInstance, { value: (value) => value === 7 });
    }
}
class Heir extends Base {}
function ask(value) {
    return value instanceof Heir;
}
console.log(ask(7), ask(new Heir()));
