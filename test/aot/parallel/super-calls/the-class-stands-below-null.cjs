class Nothing extends null { constructor(a) { return Object.assign(Object.create(Nothing.prototype), { a }); } }
class Wrong extends null { constructor() { super(); } }
function run(n) { const out = []; for (let i = 0; i < n; i++) { out.push(new Nothing(i).a); try { new Wrong(); } catch (e) { out.push(e.constructor.name); } } return out.join(" "); }
console.log(run(2));
