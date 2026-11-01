// JSON.stringify of a list of numbers under a list whose other elements may run code, and the buffer grows behind it.
let everythingPrinted = "";
function shownInTheText(value) { return (typeof value === "object" && value !== null) || typeof value === "function" || typeof value === "symbol" ? typeof value : String(value); }
function printValue(...values) { for (const value of values) everythingPrinted += shownInTheText(value) + " "; everythingPrinted += "\n"; }
function primitiveOrKind(value) { return (typeof value === "object" && value !== null) || typeof value === "function" ? typeof value : value; }
try {
} catch(e25) {
}
try {
    const v28 = {
        [v23]() {
        },
    };
} catch(e29) {
}
{
    let out = "";
    function note(value) { out += JSON.stringify(value) + ";"; }
    function total1_3(a) { let s = 0;  for (let i = 0; i < a.length; i += 1) { if (!(a[i] >= 100)) { s += 1; } else { a[i] += 1; } s += a[i]; } return s; }
    try { const list1_3_2 = (() => { const made = []; for (const each of [1, 2, 100, 4, 5, 6, 7, 100, 9, 100, 11, 100, 13, 14, 100, 100, 17, 18, 19, 20, 21]) made.push(each); return made; })(); note(total1_3(list1_3_2)); note(list1_3_2); } catch (error) { note("threw " + (error)?.constructor?.name); }
    function total1_2(a) { let s = 0;  for (let i = 0; i < a.length; i += 1) { if (a[i].value === 100.5) a[i] = { value: -1.5 }; s += a[i].value; } return s; }
    try { const list1_2_0 = Array.from({ length: 3 }, (_, at) => ({ value: at % 2 ? 100.5 : at })); note(total1_2(list1_2_0)); note(list1_2_0); } catch (error) { note("threw " + (error)?.constructor?.name); }
    printValue("handed to callbacks 2", primitiveOrKind(out));
}
{
    let out = "";
    function note(value) { let text; try { text = JSON.stringify(value) ?? String(value); } catch (error) { text = "threw"; } out += text + ";"; }
    const world = globalThis;
    function taker3_4() { const held = arguments; world.h3 = { held }; let before, behind; try { before = [...held]; } catch (error) { before = "threw"; } try { { const { held } = world.h3; Array.prototype.reverse.call(held); } } catch (error) {} try { behind = Math.max(0, ...held); } catch (error) { behind = "threw"; } return [before, behind]; }
    function taker3_3() { const held = Array.from(arguments); const later = () => { held[5000] = "far"; }; let before, behind; try { before = (([first, ...others]) => others)(held); } catch (error) { before = "threw"; } try { [1].forEach(later); } catch (error) {} try { behind = (([first, ...others]) => others)(held); } catch (error) { behind = "threw"; } return [before, behind]; }
    function taker3_2() { const held = arguments; const later = () => { Array.prototype.fill.call(held, 0); }; let before, behind; try { before = [0, ...held]; } catch (error) { before = "threw"; } try { later(); } catch (error) {} try { behind = [0, ...held]; } catch (error) { behind = "threw"; } return [before, behind]; }
    function taker3_1() { const held = arguments; world.g3 = () => { Array.prototype.fill.call(held, 0); }; let before, behind; try { before = [...held]; } catch (error) { before = "threw"; } try { world.g3(); } catch (error) {} try { behind = [...held]; } catch (error) { behind = "threw"; } return [before, behind]; }
    for (const taker of [taker3_4, taker3_3, taker3_2, taker3_1]) { note(taker("x", "y", 3)); note(taker("x")); note(taker()); note(taker.apply(null, ["x", undefined])); note(taker(...[1, 2, 3, 4])); }
}
console.log(everythingPrinted);
