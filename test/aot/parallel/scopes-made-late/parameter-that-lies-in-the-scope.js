function count(start, quick) { if (quick) return 0; const bump = () => ++start; bump(); return bump() + start; }
console.log(count(1, true), count(1, false));
