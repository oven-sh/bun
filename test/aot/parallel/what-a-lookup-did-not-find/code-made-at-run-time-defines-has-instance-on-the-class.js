class Plain {}
const lay = new Function("holder", "Object.defineProperty(holder, Symbol.hasInstance, { value: (value) => value === 7 });");
function ask(value) {
    return value instanceof Plain;
}
console.log(ask(7), ask(new Plain()));
lay(Plain);
console.log(ask(7), ask(new Plain()));
