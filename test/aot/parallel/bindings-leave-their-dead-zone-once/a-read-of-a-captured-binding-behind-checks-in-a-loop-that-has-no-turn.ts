// The same with a captured `let` of a function: the arrow is entered through unseen code in front of the declaration, for no turn.
const unseen = (0, eval)("(f, a, b) => f(a, b)");
function outer(): string {
    const measure = (flag: boolean, turns: number): number => {
        let total = 0;
        for (let i = 0; i < turns; i++) {
            total += flag ? text.length : text.length + 1;
            total += text.length;
        }
        return total;
    };
    const early = unseen(measure, true, 0);
    let text = ["ab", "cd"].join("");
    const filled = unseen(measure, false, 2);
    text = text + "e";
    return early + " " + filled + " " + unseen(measure, true, 1);
}
console.log(outer());
