class Even {
    static [Symbol.hasInstance] = (value) => value % 2 === 0;
}
function ask(value) {
    return value instanceof Even;
}
console.log(ask(2), ask(3), ask(new Even()));
