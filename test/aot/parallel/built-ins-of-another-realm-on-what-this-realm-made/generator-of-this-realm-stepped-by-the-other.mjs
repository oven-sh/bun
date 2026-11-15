import vm from "node:vm";
const other = vm.createContext({});
const inOther = (text) => vm.runInContext(text, other);
const show = (value) => { try { return JSON.stringify(value) ?? String(value); } catch (error) { return error.name; } };
const tryIt = (work) => { try { return show(work()); } catch (error) { return "threw " + error.name; } };
const p = inOther("Object.getPrototypeOf((function* () {}).prototype)"); function* count() { const got = yield 1; try { yield got; } finally { yield "closing"; } } const own = count(); console.log(tryIt(() => p.next.call(own)), tryIt(() => p.next.call(own, 7)), tryIt(() => p.return.call(own, 9)), tryIt(() => p.throw.call(own, new RangeError("r"))), tryIt(() => p.next.call(own)));
