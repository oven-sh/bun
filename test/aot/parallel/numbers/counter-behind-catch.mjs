// The text of a number that no iteration changes is joined inside a try. What the catch leads to may not go by names that the try has narrowed.
let calls = 0;
function run(c) {
  const out = [];
  let last = 0;
  const o = { x: 1, y: 2 };
  const peek = () => out.push(o.x);
  const poke = () => {
    o.x = Number(o.x) + 10;
  };
  const fail = () => {
    if (calls++ % 4 === 2) throw new Error("failed");
  };
  const end = (how) => [how, ...out, "ends with", o.x, last].map(one => (Object.is(one, -0) ? "-0" : String(one))).join();
  for (let i = 0; i < 3; i++) {
    try {
    o.x = "t" + c;
    o.x = { x: c };
    for (let q = 0; q < 3; q++) o.x = q * 0.5;
    o.x = undefined;
    o.x = o.x + 1;
    } catch {
      out.push(o.x);
    }
  }
  return end("ended");
}
const ask = run;
for (let turn = 0; turn < 2; turn++)
  for (const c of [0, 1, 2, 3, 2.5]) {
    try {
      console.log(ask(c));
    } catch (error) {
      console.log("threw", error?.message);
    }
  }
