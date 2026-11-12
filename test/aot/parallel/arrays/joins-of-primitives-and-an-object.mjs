// Few primitives joined with an object among them: what the object answers is asked once, in its place.
const asked = [];
const speaker = name => ({ toString() { asked.push(name); return "<" + name + ">"; } });
const said = [];
for (let i = 0; i < 40; i++) {
  const walk = "a" + " walks " + i;
  said.push([walk, i % 2 === 0, i, i / 2, ["name", "depth"]].join(), [speaker("first"), 1, "x", null, undefined, , -0].join("-"), [1, speaker("middle"), "y"].join(""), ["p", [1, [2, "q"]], speaker("last")].join(), [i, {}].join(), [i, () => 1].join().length, [new Date(0), 1].join().length > 5, [Object("boxed"), i].join());
  if (i % 10 === 9) try { [i, "s", { toString() { throw new Error("thrown " + i); } }].join(); } catch (error) { said.push(error.message); }
  if (i % 10 === 8) { const round = [1, "r"]; round.push(round); said.push(round.join()); }
}
let hash = 0; for (const c of said.join("|") + asked.join()) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) | 0;
console.log(hash, asked.length, said.slice(0, 8).join(" | "));
