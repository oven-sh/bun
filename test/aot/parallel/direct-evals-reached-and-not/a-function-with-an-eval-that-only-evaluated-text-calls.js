// `never` holds an eval and nothing compiled calls it. The text of another eval does: then what the scope of `never` shows is read and stored as well.
let shown = "shown to never alone";
function reader() { return "read by the text of never: " + shown; }
function never(text) { return eval(text); }
function run(text) { return eval(text); }
console.log(run("never('reader()')"));
console.log(run("never('shown = \"stored by the text of never\"; typeof run')"), shown);
