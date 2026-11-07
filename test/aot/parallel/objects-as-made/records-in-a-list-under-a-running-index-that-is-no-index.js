// Records kept in a list that a module variable holds, stored and read under a running number that another module variable holds. The number leaves the range of indexes:
// the store adds a name, the read finds it by name, and what is read has to be what was stored, whichever way the read goes.
let kept = [], at = 0;
function keep(value) { const i = at++; kept[i] = { value }; return i; }
function keepBoth(value, more) { const i = at++; kept[i] = { value, more }; return i; }
function read() { const i = at++; const cell = kept[i]; return cell.value; }
function readMore() { const i = at++; const cell = kept[i]; return cell && cell.more; }
function attempt(label, run) { try { console.log(label, String(run())); } catch (e) { console.log(label, "threw", e.constructor.name); } }
function round(label, start) {
  at = start; attempt(label + " keep", () => keep(label + "-a"));
  attempt(label + " keepBoth", () => keepBoth(label + "-b", start));
  at = start; attempt(label + " read", read); attempt(label + " read", read); attempt(label + " read past", read);
  at = start; attempt(label + " more", readMore); attempt(label + " more", readMore); attempt(label + " more past", readMore);
  console.log(label, kept.length, Object.keys(kept).join());
}
for (let turn = 0; turn < 3; turn++) {
  round("zero", 0);
  round("far", 10);
  round("last index", 4294967293);
  round("no index", 4294967295);
  round("large", 9007199254740990);
  round("negative", -2);
  round("fraction", 0.5);
  round("not a number", NaN);
  round("infinite", Infinity);
  round("minus zero", -0);
  kept.length = 1;
  round("cut", 0);
}
