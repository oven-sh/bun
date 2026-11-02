// Text made at run time adds properties, by name and by key, to objects that other such text made, while the whole heap is collected again and again.
// The end of a collection forgets how a Structure that no other object shares was reached; the store that reaches it again asks what came before it.
// Env: BUN_JSC_slowPathAllocsBetweenGCs=11
const text = (...parts) => new Function(...parts);
const names = 14;
const byName = [];
for (let t = 0; t < names; t++) byName.push(text("o", "v", "o.w" + t + " = v; return o;"));
const byKey = text("o", "k", "v", "o[k] = v; return o;");
const keys = Array.from({ length: names }, (_, t) => "w" + t);

let checksum = 0;
for (let round = 0; round < 40; round++) {
  for (let shape = 0; shape < 6; shape++) {
    const parts = [];
    for (let t = 0; t < names; t++) parts.push("r" + round + "s" + shape + "x" + t + ": base + " + t);
    const make = text("base", "var o = { " + parts.join(", ") + " }; return o;");
    const named = make(round), keyed = make(shape);
    for (let t = 0; t < names; t++) {
      const fresh = { id: round + t };
      for (let k = 0; k < 3; k++) {
        byName[t](named, fresh);
        byKey(keyed, keys[t], fresh);
      }
    }
    checksum += Object.keys(named).length * 3 + Object.keys(keyed).length + named.w13.id + keyed.w0.id;
  }
}
console.log(checksum);
