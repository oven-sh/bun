import vm from "node:vm";
const other = vm.createContext({});
const inOther = (text) => vm.runInContext(text, other);
const show = (value) => { try { return JSON.stringify(value) ?? String(value); } catch (error) { return error.name; } };
const tryIt = (work) => { try { return show(work()); } catch (error) { return "threw " + error.name; } };
const p = inOther("Object.getPrototypeOf([].values().map((x) => x))"); const own = [1, 2, 3].values().map((x) => x * 2); console.log(tryIt(() => p.next.call(own)), tryIt(() => p.next.call(own)), tryIt(() => p.return.call(own)), tryIt(() => p.next.call(own)));
