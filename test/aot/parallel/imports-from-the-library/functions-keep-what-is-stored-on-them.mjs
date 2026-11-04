function Base() {}
function helper() { return "helper"; }
function other() { return "other"; }
Base.helper = helper;
Base.Self = Base;
Object.assign(Base, { assigned: helper, Again: Base, count: 1 });
function use() { return [Base.helper(), new Base.Self() instanceof Base, Base.assigned(), new Base.Again() instanceof Base, Base.count, typeof Base.missing].join(); }
const said = [];
for (let i = 0; i < 6; i++) {
  if (i === 1) Base.helper = other;
  if (i === 2) Object.assign(Base, { assigned: other, count: "two" });
  if (i === 3) Base.Self = function Fake() {};
  if (i === 4) delete Base.assigned, Object.defineProperty(Base, "assigned", { get() { return () => "got"; } });
  if (i === 5) Base["Ag" + "ain"] = class Late {};
  said.push(use());
}
console.log(said.join(" "));
