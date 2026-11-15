class First {}
class Second {}
class Heir extends Second {}
function lay(holder) {
    Object.defineProperty(holder, Symbol.hasInstance, { value: (value) => value === 7 });
}
function ask(value) {
    return value instanceof Heir;
}
console.log(ask(7), ask(new Heir()));
lay(First);
lay(Second);
console.log(ask(7), ask(new Heir()));
