function Box(v) {
  this.v = v;
}

function bump(b) {
  b.v = b.v + 1;
}

let last = null;

function readsAcrossNothing(b, p) {
  const x = b.v;
  last = p;
  return x + b.v;
}

function readsAcrossSpread(b, p) {
  const x = b.v;
  last = { ...p };
  return x + b.v;
}

function readsAcrossGetterLiteral(b, k) {
  const x = b.v;
  last = {
    get twice() {
      return k * 2;
    },
  };
  return x + b.v;
}

let total = 0;
const p = { x: 1, y: 2 };
for (let i = 0; i < 1000; i++) {
  const b = new Box(i);
  bump(b);
  total += readsAcrossNothing(b, p) + readsAcrossSpread(b, p) + readsAcrossGetterLiteral(b, i);
}
console.log(total, typeof last);
