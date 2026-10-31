// A read of a member of a function right behind a store to it: the store may not take, or something between may change what is read.
function plain() {}
(plain as any).n = 0;
function bump(i: number) {
  (plain as any).n = ((plain as any).n + i) & 255;
  return (plain as any).n;
}
let sum = 0;
for (let i = 0; i < 2000; i++) sum += bump(i);
console.log(sum);

function frozen() {}
(frozen as any).n = 1;
Object.freeze(frozen);
function sloppyStore() {
  return new Function("f", "f.n = 2; return f.n;")(frozen);
}
console.log(sloppyStore());
function storeFrozen(i: number) {
  try {
    (frozen as any).n = i;
  } catch (error) {
    return (error as Error).name + " " + (frozen as any).n;
  }
  return (frozen as any).n;
}
console.log(storeFrozen(3));

function sealedOne() {}
Object.preventExtensions(sealedOne);
function storeSealed() {
  try {
    (sealedOne as any).n = 1;
  } catch (error) {
    return (error as Error).name + " " + (sealedOne as any).n;
  }
  return (sealedOne as any).n;
}
console.log(storeSealed());

function named() {}
function storeName() {
  try {
    (named as any).name = "other";
  } catch (error) {
    return (error as Error).name + " " + named.name;
  }
  return named.name;
}
console.log(storeName());

function withSetter() {}
let seen = 0;
Object.defineProperty(withSetter, "n", { get: () => seen + 100, set: value => (seen = value), configurable: true });
function storeSetter(i: number) {
  (withSetter as any).n = i;
  return (withSetter as any).n;
}
console.log(storeSetter(1), storeSetter(2));

function deletedBetween() {}
function storeDelete() {
  (deletedBetween as any).n = 1;
  delete (deletedBetween as any).n;
  return (deletedBetween as any).n;
}
console.log(storeDelete());

function otherArm() {}
function storeOnOneArm(flag: boolean) {
  if (flag) (otherArm as any).n = 1;
  else (otherArm as any).n = 2;
  return (otherArm as any).n;
}
console.log(storeOnOneArm(true), storeOnOneArm(false));

function calledBetween() {}
function change() {
  (calledBetween as any).n = 7;
}
function storeCall(i: number) {
  (calledBetween as any).n = i;
  change();
  return (calledBetween as any).n;
}
console.log(storeCall(1));

function ofAString() {}
function storeOtherKinds(value: unknown) {
  (ofAString as any).n = value;
  return (ofAString as any).n;
}
console.log(storeOtherKinds(1), storeOtherKinds("text"), storeOtherKinds(null), storeOtherKinds(undefined));
