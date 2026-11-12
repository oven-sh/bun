var held = 1;
let later = "not yet";
function helper() { return "the helper was called"; }
function once(text) { const own = 5; return eval(text); }
console.log(once("held + own"), once("helper()"), once("held = 7; later = 'stored by the text'; typeof once"));
console.log(held, later);
const lazily = () => eval("held * 2");
if (process.argv.length < 9) console.log(lazily());
