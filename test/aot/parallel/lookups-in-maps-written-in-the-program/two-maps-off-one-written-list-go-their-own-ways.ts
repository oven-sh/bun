const make = () => new Map([["aa", 1], ["bb", 2]]); const a = make(), b = make(); a.get("aa"); b.get("aa"); a.set("aa", 9); a.delete("bb");
console.log(a.get("aa"), a.get("bb"), b.get("aa"), b.get("bb"), a.size, b.size);
const c0 = new Map([["aa", "x1"], ["bb", "x2"]]); c0.get("aa"); const c = new Map(c0), d = structuredClone(c0); c.set("bb", "y"); d.delete("aa");
console.log(c0.get("aa"), c0.get("bb"), c.get("aa"), c.get("bb"), d.get("aa"), d.get("bb"), c0.size, c.size, d.size);
