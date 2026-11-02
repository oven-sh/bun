// Switch falls through and default in the middle: compiled answers as plain.
function s(x) {
  const o = [];
  switch (x) {
    case 1:
      o.push(1);
    default:
      o.push("d");
    case 2:
      o.push(2);
      break;
    case 3:
      o.push(3);
  }
  return o.join();
}
console.log(s(1), s(2), s(3), s(4), s("1"));
