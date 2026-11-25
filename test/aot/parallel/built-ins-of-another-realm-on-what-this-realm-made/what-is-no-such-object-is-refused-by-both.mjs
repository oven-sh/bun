import vm from "node:vm";
const other = vm.createContext({});
const inOther = (text) => vm.runInContext(text, other);
const show = (value) => { try { return JSON.stringify(value) ?? String(value); } catch (error) { return error.name; } };
const tryIt = (work) => { try { return show(work()); } catch (error) { return "threw " + error.name; } };
const theirs = inOther("[Object.getPrototypeOf([].values().map((x) => x)), Object.getPrototypeOf((function* () {}).prototype), Object.getPrototypeOf([].values()), Object.getPrototypeOf(Iterator.from({ next() {} }))]"); for (const p of theirs) for (const bad of [{}, 1, null, [].values().map((x) => x), (function* () {})(), [].values()]) console.log(tryIt(() => p.next.call(bad)));
