// Five calls in a row, each of one of four functions and each handed what the call before gave: the rows of arms stand one behind the other, none inside an arm of another.
// STATISTIC: CallsToldApartByCallee >= 5
// STATISTIC: CallsToldApartByCallee <= 10
function A(x) { let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0; return (x + work + 0) | 0; }
function B(x) { let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0; return (x + work + 1) | 0; }
function C(x) { let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0; return (x + work + 2) | 0; }
function D(x) { let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0; return (x + work + 3) | 0; }
function run() {
  let sum = 0;
  for (let i = 0; i < 1024; i++) {
    const d0 = (i >> 0) & 3, f0 = d0 === 0 ? A : d0 === 1 ? B : d0 === 2 ? C : D;
    const d1 = (i >> 2) & 3, f1 = d1 === 0 ? A : d1 === 1 ? B : d1 === 2 ? C : D;
    const d2 = (i >> 4) & 3, f2 = d2 === 0 ? A : d2 === 1 ? B : d2 === 2 ? C : D;
    const d3 = (i >> 6) & 3, f3 = d3 === 0 ? A : d3 === 1 ? B : d3 === 2 ? C : D;
    const d4 = (i >> 8) & 3, f4 = d4 === 0 ? A : d4 === 1 ? B : d4 === 2 ? C : D;
    let r = 0;
    r = f0(r);
    r = f1(r);
    r = f2(r);
    r = f3(r);
    r = f4(r);
    sum = (sum + r) | 0;
  }
  return sum;
}
console.log(run());
