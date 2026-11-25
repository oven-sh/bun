function seal(e) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  Object.defineProperty(e, "prototype", { writable: false });
  return e;
}
function One() {}
function Two() {}
const one = seal(One);
const two = seal(Two);
console.log(one === One, two === Two, typeof one, typeof two);
