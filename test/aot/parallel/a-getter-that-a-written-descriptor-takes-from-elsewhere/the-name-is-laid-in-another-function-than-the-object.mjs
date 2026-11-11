function lazy(make) { return () => make(); }
function lay(target, getter) { Object.defineProperty(target, "part", { get: getter }); return target; }
function layInSight(target) { Object.defineProperty(target, "part", { get: function () { return 2; } }); return target; }
const one = lay({}, lazy(() => 7)), two = layInSight({}), three = lay({ kept: 1 }, async () => 3);
function use(holder) { let told = ""; for (let i = 0; i < 5; i++) told += typeof holder.part; return told; }
let said = ""; for (let turn = 0; turn < 300; turn++) said = use(one) + use(two) + use(three);
console.log(said, await three.part);
