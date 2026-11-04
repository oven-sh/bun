async function load(k) { throw new Error("load"); }
async function ask(k, slow) {
  try { const yes = await (slow ? load(k) : (k === 1 || k === 4 || k === 9)); console.log("answer " + yes); } catch (e) { console.log("caught " + e.message); }
}
ask(4, false); console.log("behind the first");
ask(4, true); console.log("behind the second");
