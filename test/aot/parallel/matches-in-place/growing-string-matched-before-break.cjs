// A string that grows in a loop is matched itself, and the match decides together with another condition whether the loop ends. The build prints nothing.
function breaks(n) {
  let text = "";
  for (let i = 0; i < n; i++) {
    text += "a";
    if (text.match(/^c/m) && i > 2) break;
  }
  return text;
}
function breaksInside(n) {
  let text = "";
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < n; i++) {
      text += "a";
      if (text.match(/a{7}/) && i > 2) break;
    }
  }
  return text;
}
function takesGroups(n) {
  let text = "x";
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < n; i++) {
      text += i;
      const match = text.match(/(\d)(\d)$/);
      if (match && i > 2) {
        text += match[1];
        break;
      }
    }
  }
  return text;
}
function whileBoth(n) {
  let text = "";
  let other = "";
  let i = 0;
  while (i++ < n) {
    let k = 0;
    while (k++ < 3) {
      text += "ab";
      other += "c";
      if (text.match(/b$/) && k > 1) break;
    }
  }
  return text + other;
}
function matchesOther(n, subject = "abc") {
  let text = "";
  for (let i = 0; i < n; i++) {
    const match = subject.match(/b(c)/);
    text += "a";
    if (match && i > 2) {
      text += match[1];
      break;
    }
  }
  return text;
}
for (const n of [0, 1, 3, 5, 9]) console.log(breaks(n), breaksInside(n), takesGroups(n), whileBoth(n), matchesOther(n));
