const log = [];
class Source { constructor(n, way = "") { this.left = n; this.way = way; this.pad = { tag: "pad" + n, list: [n, n + 1] }; }
  [Symbol.asyncIterator]() { return this; }
  next() { junk(); if (this.way === "rejects" && this.left === 2) { this.left--; return Promise.reject(new RangeError("next")); } if (this.way === "throws" && this.left === 2) { this.left--; throw new RangeError("thrown"); } if (this.way === "no object" && this.left === 2) { this.left--; return Promise.resolve(7); }
    return new Promise(done => setTimeout(() => { junk(); done(this.left > 0 ? { done: false, value: this.left-- + this.pad.list.length } : { done: true, value: undefined }); }, 0)); }
  return(v) { log.push("return@" + this.left + this.pad.tag); if (this.way === "return rejects") return Promise.reject(new TypeError("return")); if (this.way === "return no object") return Promise.resolve(3); return Promise.resolve({ done: true, value: v }); } }
function junk() { const list = []; for (let i = 0; i < 300; i++) list.push({ i, text: "t" + i }); Bun.gc(true); return list.length; }
async function tell(run) { try { return "= " + (await run()); } catch (error) { return "threw " + error.name + ":" + error.message; } }
async function* doubled(n) { for await (const v of new Source(n)) { junk(); yield v * 2; junk(); } }
async function drain(n, stop) { let text = ""; for await (const d of doubled(n)) { text += d + ","; if (d === stop) break; } return text; }
console.log(await tell(() => drain(3, -1)), await tell(() => drain(4, 10)), log.join());
