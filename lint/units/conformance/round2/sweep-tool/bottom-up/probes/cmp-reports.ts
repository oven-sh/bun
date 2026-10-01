const [a, b] = await Promise.all(process.argv.slice(2, 4).map(p => Bun.file(p).json()));
const same = (k: string) => Bun.deepEquals(a[k], b[k]);
const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
console.log(keys.map(k => `${k}: ${same(k) ? "same" : "DIFFERENT"}`).join(", "));
console.log("only", JSON.stringify(b.only), "resumed", JSON.stringify(b.resumed));
console.log("totals", JSON.stringify(b.totals));
console.log("directoryOutcomes compiler", JSON.stringify(b.directoryOutcomes.compiler), "conformance/types/tuple", JSON.stringify(b.directoryOutcomes["conformance/types/tuple"]));
console.log("codes TS2322", JSON.stringify(b.codes.TS2322));
console.log("instance", JSON.stringify(b.instances["castingTuple.ts"]));
