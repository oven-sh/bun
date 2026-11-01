// One closure over a written variable leaves the frame while another closure of the frame still reads the variable: thrown and caught, chosen at a join, made in a loop over a variable of the function.
const box = { f: null };
function borrows(f) { return f(1); }

function thrownAndCaught(i) {
  let n = 0;
  const inc = d => { n += d; return n; };
  const get = () => n;
  borrows(inc); borrows(get);
  try {
    if (i & 1) throw inc;
  } catch (e) {
    box.f = e;
    n += 100;
    return borrows(get) * 1000 + box.f(1);
  }
  return n;
}

function chosenAtAJoin(i) {
  let n = 0;
  const inc = d => { n += d; return n; };
  const dec = d => { n -= d; return n; };
  const get = () => n;
  borrows(inc); borrows(dec); borrows(get);
  const chosen = (i & 1) ? inc : dec;
  box.f = chosen;
  n += 100;
  return borrows(get) * 1000 + box.f(1) + borrows(get);
}

function madeInALoopOverAVariableOfTheFunction(i) {
  let n = 0;
  const get = () => n;
  borrows(get);
  for (let k = 0; k < 3; k++) {
    const inc = d => { n += d; return n; };
    borrows(inc);
    if ((i + k) & 1) box.f = inc;
  }
  n += 100;
  return borrows(get) * 1000 + (box.f ? box.f(1) : 0) + borrows(get);
}

let a = 0, b = 0, c = 0;
for (let i = 0; i < 1000; i++) { a += thrownAndCaught(i); b += chosenAtAJoin(i); c += madeInALoopOverAVariableOfTheFunction(i); }
console.log(a, b, c);
