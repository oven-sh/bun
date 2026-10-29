// Two closures over one written variable lie in the frame while they are only borrowed. One of them leaves on a path that seldom runs: it is made again on the heap there, and the variable moves to the heap with it.
// The other closure is still used behind that point and has to see the same variable.
const box = { f: null, g: null };
function borrows(f) { return f(1); }
function borrowsTwo(f, g) { f(10); return g(); }

function storedInAField(i) {
  let n = 0;
  const inc = d => { n += d; return n; };
  const get = () => n;
  borrows(inc); borrows(get);
  if (i & 1) {
    box.f = inc;
    n += 100;
    return borrows(get);
  }
  return n;
}

function theOtherOneWrites(i) {
  let n = 0;
  const inc = d => { n += d; return n; };
  const get = () => n;
  borrows(inc); borrows(get);
  if (i & 1) {
    box.g = get;
    borrows(inc);
    return box.g() * 1000 + n;
  }
  return n;
}

function keeps(f, g) { box.f = f; f(5); return g(); }
function bothGoIntoOneCall(i) {
  let n = 0;
  const inc = d => { n += d; return n; };
  const get = () => n;
  borrows(inc); borrows(get);
  if (i & 1)
    return keeps(inc, get) * 1000 + borrows(get);
  return n;
}

function inALoop(i) {
  let sum = 0;
  for (let k = 0; k < 3; k++) {
    let n = k;
    const inc = d => { n += d; return n; };
    const get = () => n;
    borrowsTwo(inc, get);
    if ((i + k) & 1) {
      box.f = inc;
      n += 100;
      sum += borrows(get);
      sum += box.f(1);
      sum += borrows(get);
    }
    sum += n;
  }
  return sum;
}

let a = 0, b = 0, c = 0, d = 0;
for (let i = 0; i < 1000; i++) { a += storedInAField(i); b += theOtherOneWrites(i); c += bothGoIntoOneCall(i); d += inALoop(i); }
console.log(a, b, c, d);
