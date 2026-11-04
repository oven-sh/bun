const f = globalThis.nothing || (async () => y);
const early = f().then(String, error => error.name);
let y = 2;
early.then(before => f().then(after => console.log(before, after)));
