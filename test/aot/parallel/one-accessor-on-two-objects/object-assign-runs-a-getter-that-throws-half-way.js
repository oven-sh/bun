// Object.assign runs the getter of its source, which throws: what stands in front of it is copied, what stands behind it is not.
const target = { first: 0, value: 0, last: 0 };
const source = { first: 1, get value() { if (this.first) throw new RangeError("half way"); return 2; }, last: 3 };
function copy(into, from) { try { Object.assign(into, from); return "whole"; } catch (error) { return error.constructor.name; } }
console.log(copy(target, source), target.first, target.value, target.last);
