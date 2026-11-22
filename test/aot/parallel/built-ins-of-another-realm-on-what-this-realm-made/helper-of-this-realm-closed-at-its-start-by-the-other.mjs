import vm from "node:vm";
const other = vm.createContext({});
const inOther = (text) => vm.runInContext(text, other);
const show = (value) => { try { return JSON.stringify(value) ?? String(value); } catch (error) { return error.name; } };
const tryIt = (work) => { try { return show(work()); } catch (error) { return "threw " + error.name; } };
const p = inOther("Object.getPrototypeOf([].values().map((x) => x))"); let closed = 0; const under = { next() { return { value: 1, done: false }; }, return() { closed++; return {}; }, __proto__: Iterator.prototype }; const own = under.filter((x) => x); console.log(tryIt(() => p.return.call(own)), closed, tryIt(() => own.next()));
