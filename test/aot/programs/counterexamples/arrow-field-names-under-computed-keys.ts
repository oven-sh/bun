// Arrow functions in fields under computed keys are named after the key.
declare const console: { log(...a: unknown[]): void };
const k = "k";
class H { static [k] = () => 1; [k] = () => 1; static fixed = () => 1; }
console.log(JSON.stringify(H[k].name), JSON.stringify(new H()[k].name), JSON.stringify(H.fixed.name));
