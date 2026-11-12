import vm from "node:vm";
const other = vm.createContext({});
const inOther = (text) => vm.runInContext(text, other);
const show = (value) => { try { return JSON.stringify(value) ?? String(value); } catch (error) { return error.name; } };
const tryIt = (work) => { try { return show(work()); } catch (error) { return "threw " + error.name; } };
const p = inOther("Object.getPrototypeOf([].values().map((x) => x))"); const list = () => [1, 2, 3, 4].values(); for (const own of [list().map((x) => x + 1), list().filter((x) => x & 1), list().take(2), list().drop(2), list().flatMap((x) => [x, x])]) console.log(tryIt(() => p.next.call(own)), tryIt(() => p.next.call(own)), tryIt(() => p.return.call(own)));
