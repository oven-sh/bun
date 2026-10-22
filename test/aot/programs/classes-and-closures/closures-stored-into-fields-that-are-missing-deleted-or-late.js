// Objects of one shape whose members hold functions: some lack a member, lose it, or get it late.
function make(options) {
  return {
    first: options.first,
    openArm: () => "open",
    second: options.second,
    closeArm: () => "close",
    third: options.third,
    lastArm: () => "last",
  };
}
function describe(one) {
  return [typeof one.openArm, typeof one.closeArm, typeof one.lastArm, one.lastArm?.(), Object.keys(one).join("+")].join(" ");
}
const bare = make({});
delete bare.lastArm;
console.log(describe(bare), describe(make({ first: 1 })));
bare.lastArm = () => "late";
console.log(describe(bare), bare.lastArm === bare.lastArm);
const partial = { first: 1, openArm: undefined, second: 2 };
console.log(describe(partial), describe(Object.assign({}, make({ third: 3 }), { closeArm: null })));
