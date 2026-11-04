// A Number object is converted by valueOf, a String object by toString, each found by name, on the object first.
function holder(value) { return { value }; }
function text(value) { return JSON.stringify(holder(value)); }
const number = new Number(1);
const string = new String("t");
const flag = new Boolean(false);
for (let turn = 0; turn < 2; ++turn) {
    console.log(text(number), text(string), text(flag), text(1), text("t"));
    number.valueOf = () => { console.log("valueOf"); return 2; };
    string.toString = () => { console.log("toString"); return "u"; };
}
