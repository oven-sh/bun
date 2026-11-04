// A module's `let` is read three times in a turn. The checks of the first two stand in the arms of the loop; the third read follows them and has none.
// Laid in front of the loop it would read the empty binding where the loop has no turn.
function measure(flag: boolean, turns: number): number {
    let total = 0;
    for (let i = 0; i < turns; i++) {
        total += flag ? text.length : text.length + 1;
        total += text.length;
    }
    return total;
}
const yes = Boolean(JSON.parse("1"));
const none = Number(JSON.parse("0"));
const two = Number(JSON.parse("2"));
console.log("no turn in the dead zone:", measure(yes, none));
let caught = "nothing";
try { measure(!yes, two); } catch (error) { caught = (error as Error).name; }
console.log("two turns in the dead zone:", caught);
let text = ["ab", "cd"].join("");
console.log("filled:", measure(yes, two));
text = text + "e";
console.log("stored again:", measure(!yes, two));
