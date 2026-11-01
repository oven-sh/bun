// Flags: --aot-validate
// map() | forEach() | filter() | some() hand the list itself to the callback as the third argument. A constructor (a callee that ResolveCalls makes in the pass) or a plain callee changes that list in mid-walk.
const turns = process.argv.length + 2;
function line(name, run) { let answer; try { answer = run(); } catch (error) { answer = error.name + ": " + String(error.message).slice(0, 60); } console.log(name + ": " + answer); }
const show = made => JSON.stringify(made.map(each => each && typeof each === "object" && "value" in each ? each.value : each));
const changes = {
  "a fraction at 1": all => { all[1] = 1.5; },
  "an object at 1": all => { all[1] = { toJSON() { return "object"; } }; },
  "a string at 2": all => { all[2] = "two"; },
  "cut to one": all => { all.length = 1; },
  "emptied": all => { all.length = 0; },
  "grown": all => { if (all.length < 6) all.push(all.length * 10); },
  "a hole at 1": all => { delete all[1]; },
  "sparse": all => { all[100000] = 1; all.length = 3; },
  "an accessor at 1": all => { Object.defineProperty(all, 1, { get() { return 77; }, configurable: true, enumerable: true }); },
  "a prototype with 1": all => { delete all[1]; Object.setPrototypeOf(all, { 1: 88, __proto__: Array.prototype }); },
  "frozen": all => { Object.freeze(all); },
  "shifted": all => { all.shift(); },
  "reversed": all => { all.reverse(); },
};
for (const [name, change] of Object.entries(changes)) {
  line("map, a constructor: " + name, () => {
    function Holder(value, all) { this.value = value; if (!all.done) { all.done = true; change(all); } }
    let text = "";
    for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Holder(value, all))); }
    return text;
  });
  line("map, a constructor, no mark on the list: " + name, () => {
    let done = false;
    function Holder(value, all) { this.value = value; if (!done) { done = true; change(all); } }
    let text = "";
    for (let i = 0; i < turns; i++) { done = false; const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Holder(value, all))); }
    return text;
  });
  line("map, a class: " + name, () => {
    let done = false;
    class Holder { constructor(value, all) { this.value = value; if (!done) { done = true; change(all); } } }
    let text = "";
    for (let i = 0; i < turns; i++) { done = false; const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Holder(value, all))); }
    return text;
  });
  line("map, the arrow itself: " + name, () => {
    let done = false;
    let text = "";
    for (let i = 0; i < turns; i++) { done = false; const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => { if (!done) { done = true; change(all); } return value; })); }
    return text;
  });
  line("forEach, a constructor: " + name, () => {
    let done = false;
    const seen = [];
    function Holder(value, all) { seen.push(value); if (!done) { done = true; change(all); } }
    for (let i = 0; i < turns; i++) { done = false; const source = [i + 1, i + 2, i + 3]; source.forEach((value, index, all) => { new Holder(value, all); }); }
    return JSON.stringify(seen);
  });
  line("filter, a constructor: " + name, () => {
    let done = false;
    function Holder(value, all) { this.keep = true; if (!done) { done = true; change(all); } }
    let text = "";
    for (let i = 0; i < turns; i++) { done = false; const source = [i + 1, i + 2, i + 3]; text += JSON.stringify(source.filter((value, index, all) => new Holder(value, all).keep)); }
    return text;
  });
  line("the list is not handed over, the constructor finds it in a variable: " + name, () => {
    let done = false;
    let source = null;
    function Holder(value) { this.value = value; if (!done) { done = true; change(source); } }
    let text = "";
    for (let i = 0; i < turns; i++) { done = false; source = [i + 1, i + 2, i + 3]; text += show(source.map(value => new Holder(value))); }
    return text;
  });
}
