const m = new Map<string, any>([["u", undefined], ["n", null], ["t", true], ["f", false], ["z", -0], ["nan", NaN], ["d", 2.5], ["i", 7], ["big", 12345678901234567890n], ["s", "said"], ["never", "never-said-elsewhere"], ["e", ""]]);
const ks = ["u", "n", "t", "f", "z", "nan", "d", "i", "big", "s", "never", "e", "absent"]; let out = "";
for (let r = 0; r < 3; r++) for (const k of ks) { const v = m.get(k); out += (Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : String(v)) + ","; }
console.log(out);
