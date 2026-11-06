// Flags: --aot-validate
// Callbacks whose function objects lie in a frame are called by value by the methods of lists. The entrypoint for such calls records what it was entered through, and the build that checks
// itself lets it: of a function object in a frame the record keeps where it lay, and nobody follows that.
{
    let out = "";
    function list1_4() { const a = JSON.parse("[1,2,3]"); try { a[a.length + 5] = 4; } catch {} try { a[a.length + 5] = 4; } catch {} return [a.toString().length, a.slice(0, 3), a.hasOwnProperty(1), a.map(x => x).length, a.hasOwnProperty(1)]; }
    function list1_3() { const a = Object.keys({ k: 1 }); try { a.unshift(0); } catch {} return [(() => { let seen = 0; a.forEach(() => seen++); return seen; })(), a.flat().length, (([first, second]) => [first, second])(a), a[a.length - 1], a[1]]; }
    function list1_2() { const a = Object.keys({ k: 1, l: 2 }); try { a.pop(); } catch {} return [a.slice(0, 3), a.flat().length, a.at(0), (() => { const seen = []; for (const x of a) { if (seen.length < 3) seen.push(x); } return seen; })(), a.concat([1]).length, a[0]]; }
    function list1_1() { const a = JSON.parse("[1,2,3]"); try { a[a.length + 5] = 4; } catch {} return [a.indexOf(2), a[a.length - 1], Object.keys(a).length, a.entries().next().value, a.map(x => x).length, [...a].length, (([first, second]) => [first, second])(a)]; }
    for (let turn = 0; turn < 2; turn++) try { const got = list1_4(); if (turn === 0) note(got); } catch (error) { note("threw"); }
    for (const made of [list1_4, list1_3, list1_2, list1_1]) try { note(made()); } catch (error) { note("threw"); }
    function note(value) { out += (typeof value === "symbol" ? "symbol" : typeof value === "function" ? "function" : typeof value === "object" && value !== null ? JSON.stringify(value) : typeof value + " " + String(value)) + ";"; }
    const key2_3 = String("length");
    const make2_3 = () => (Object.defineProperties({}, Object.getOwnPropertyDescriptors([7, 8])));
    const o2_3_4 = make2_3(); note(o2_3_4?.[key2_3] > 0);
    console.log(out);
}
