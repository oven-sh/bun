// a text out of data is compared with a written one.
const own = ["alpha", "beta", "gamma", "delta"], data = JSON.parse('["alpha","beta","gamma","delta"]'), cut = "xalphaxbetaxgammaxdelta".split("x").slice(1);
function kind(w) { return w === "alpha" ? 1 : w === "beta" ? 2 : w === "gamma" ? 3 : 4; }
export const loops = {
  "texts of the program": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (kind(own[i & 3]))) | 0; return s; },
  "texts out of data": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (kind(data[i & 3]))) | 0; return s; },
  "texts that were cut out": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (kind(cut[i & 3]))) | 0; return s; },
};
