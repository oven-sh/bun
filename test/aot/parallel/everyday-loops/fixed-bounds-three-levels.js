// Three levels with written bounds push onto one list
function clock(scale) {
  const ticks = [];
  for (let h = 0; h < 2; h++) {
    for (let m = 0; m < 2; m++) {
      for (let s = 0; s < 2; s++) ticks.push((h * 60 + m) * scale + s);
      ticks.push(-m);
    }
    ticks.push(h + 100);
  }
  return ticks.join() + " " + ticks.length;
}
console.log(clock(60));
console.log(clock(0.5));
console.log(clock(-1e9), clock(0));
