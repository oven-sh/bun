function haveSameLetters(a, b) {
  if (a.length !== b.length) return false;
  const counts = new Array(26).fill(0);
  for (let i = 0; i < a.length; i++) {
    counts[a.charCodeAt(i) - 97]++;
    counts[b.charCodeAt(i) - 97]--;
  }
  for (let i = 0; i < 26; i++) {
    if (counts[i] !== 0) return false;
  }
  return true;
}
console.log(haveSameLetters(JSON.parse('"listen"'), JSON.parse('"silent"')), haveSameLetters("ab", "ac"));
