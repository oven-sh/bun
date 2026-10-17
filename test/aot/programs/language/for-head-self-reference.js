// `for (let x of [x])`: what stands behind `of` or `in` is evaluated where the loop's own names are declared and hold nothing yet.
function tell(name, f) {
  try {
    console.log(name, f());
  } catch (error) {
    console.log(name, error.constructor.name);
  }
}
tell("let in", () => { let x = 1; for (let x in { x }) return "entered"; return "left"; });
tell("const in", () => { let x = 1; for (const x in { x }) return "entered"; return "left"; });
tell("let of", () => { let x = 1; for (let x of [x]) return "entered"; return "left"; });
tell("const of", () => { let x = 1; for (const x of [x]) return "entered"; return "left"; });
tell("a pattern", () => { let b = 1; for (const [a, b] of [[b, 2]]) return "entered"; return "left"; });
tell("a pattern's other name", () => { let a = 1; for (const { a, b } of [{ a, b: 2 }]) return "entered"; return "left"; });
tell("var", () => { for (var x of [x]) return String(x); return "left"; });
tell("not evaluated", () => { let x = 1; for (let x of true ? [5] : [x]) return x; return "left"; });
tell("typeof", () => { for (let x of [typeof x]) return x; return "left"; });
tell("in a function that is called at once", () => { for (let x of [(() => x)()]) return x; return "left"; });
tell("in a function that is called later", () => { const all = []; for (let x of [() => x, () => x]) all.push(x); return all.map(f => typeof f()).join(); });
tell("another name", () => { let y = 3; for (let x of [y]) return x; return "left"; });
tell("twice", () => { let n = 0; for (let turn = 0; turn < 2; turn++) { try { for (let x of [x]) n += 10; } catch { n++; } } return n; });
async function later() {
  try {
    for await (let x of [x]) return "entered";
    return "left";
  } catch (error) {
    return error.constructor.name;
  }
}
later().then(said => console.log("for await", said));
let top = 1;
try {
  for (let top of [top]) console.log("entered");
} catch (error) {
  console.log("at the top level", error.constructor.name);
}
