// The trap answers the same text under every name, and a text is nothing that the host could call.
// STATISTIC: ImageFunctionsEmitted <= 20
let asked = 0;
const below = Object.create(new Proxy({}, { get() { asked++; return "a"; } }));
console.log(below.first, below.second, asked);
console.log(Object.keys(below).length);
