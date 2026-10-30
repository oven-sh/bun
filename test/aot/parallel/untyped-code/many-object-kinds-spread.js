// Env: JSC_aotCountsPath=/dev/null
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const visits = () => count("operationAOTCopyObject");
const sources = [];
for (let kind = 0; kind < 48; kind++) {
    const source = {};
    for (let i = 0; i <= kind % 5; i++) source["k" + kind + "n" + i] = kind * 10 + i;
    sources.push(source);
}
const alone = o => ({ ...o });
const withOne = (o, v) => ({ ...o, extra: v });
const withTwo = (o, v, w) => ({ ...o, extra: v, other: w });
const digest = o => Object.keys(o).join() + "=" + Object.values(o).join();
let text = 0;
const sum = s => { for (let i = 0; i < s.length; i++) text = (Math.imul(text, 31) + s.charCodeAt(i)) | 0; };
const round = n => {
    for (const source of sources) { sum(digest(alone(source))); sum(digest(withOne(source, n))); sum(digest(withTwo(source, n, -n))); }
};
round(1);
console.log("48 kinds, three ways:", text, digest(withTwo(sources[7], 1, 2)), "|", digest(alone(sources[44])), "|", digest(withOne(sources[0], 5)));
const quick = n => { let kept = 0; for (const source of sources) kept += alone(source)["k0n0"] === 0 ? 1 : 0, kept += withOne(source, n).extra, kept += withTwo(source, n, 1).other; return kept; };
let kept = 0;
for (let i = 0; i < 100; i++) kept += quick(i);
const before = visits();
for (let i = 0; i < 500; i++) kept += quick(i);
const visited = visits() - before;
console.log("kept:", kept);
console.log("the run time is asked for at most one copy in four of 72000, of 144 kinds in turn:", typeof aotOperationCount !== "function" || visited <= 18000);
