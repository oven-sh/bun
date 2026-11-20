function choose(kind, value) {
  switch (kind) {
    case 0:
      value += 1;
    case 1:
      value += 10;
      break;
    case 2:
      break;
    default:
      value = -value;
  }
  return () => value++;
}
console.log([0, 1, 2, 3].map((kind) => { const read = choose(kind, 5); return read() + read(); }).join());
