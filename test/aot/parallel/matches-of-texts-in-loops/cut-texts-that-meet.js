// STATISTIC: SubstringsCarriedByPosition >= 6
function scan(text, pattern) {
  return text.match(pattern);
}
function joined(s) {
  let count = 0;
  while (s.length) {
    const m = s.match(/^[a-z]+/);
    if (m) {
      count += m[0].length;
      s = s.slice(m[0].length);
    } else {
      count++;
      s = s.slice(1);
    }
  }
  return count;
}
function truth(s) {
  let count = 0;
  while (s) {
    const m = s.match(/^[a-zä]+/);
    if (m) {
      count++;
      s = s.substring(m[0].length);
    } else s = s.substring(1);
  }
  return count;
}
function executed(s) {
  const words = [];
  while (s.length) {
    const m = /^[a-z]+/.exec(s);
    if (m) {
      words.push(m[0]);
      s = s.slice(m[0].length);
    } else s = s.slice(1);
  }
  return words.join();
}
function helped(s) {
  let count = 0;
  while (s.length) {
    const m = scan(s, /^[a-z]+/);
    if (m) {
      count++;
      s = s.slice(m[0].length);
    } else s = s.slice(1);
  }
  return count;
}
function broken(s) {
  let count = 0;
  while (s.length) {
    const m = s.match(/^[a-z]+/);
    if (m) {
      count++;
      s = s.slice(m[0].length);
    } else s = s.slice(1);
    if (count > 2) break;
  }
  return count + s.length;
}
function returned(s) {
  let count = 0;
  while (s.length) {
    const m = s.match(/^[a-z]+/);
    if (m) s = s.slice(m[0].length);
    else s = s.slice(1);
    if (++count === 3) return s;
  }
  return count;
}
function tokens(s) {
  let sum = 0;
  let m;
  while (s) {
    if ((m = /^[a-z]+/.exec(s))) {
      sum += m[0].length;
      s = s.substring(m[0].length);
      continue;
    }
    if ((m = /^ +/.exec(s))) {
      sum += 100;
      s = s.substring(m[0].length);
      continue;
    }
    if (s.charCodeAt(0) === 44) sum += 10000;
    s = s.substring(1);
  }
  return sum;
}
function prefixes(s) {
  let count = 0;
  while (s.length) {
    if (s.startsWith("ab")) count++;
    if (/^[ ,]/.test(s)) count += 100;
    s = s.slice(1);
    if (s.length > 3 && s.startsWith("c")) s = s.slice(2);
  }
  return count;
}
function twice(s) {
  let count = 0;
  while (s.length > 1) {
    let rest = s.slice(1);
    if (/^[a-z]/.test(rest)) count++;
    if (rest.length > 4) rest = rest.slice(1);
    s = rest;
  }
  return count + s;
}
const texts = JSON.parse(JSON.stringify(["abc1 de23, f", "", "a", "  x1 y,z ab", "äöü1 a😀b", "ab,cd.ef gh,", "日本 abcab", "q".repeat(9) + ","]));
texts.push(("abc" + "1 d").slice(1), ("x" + "12 ab cd ef gh ij kl").substring(3));
for (const text of texts) console.log(joined(text), truth(text), executed(text), helped(text), broken(text), returned(text), tokens(text), prefixes(text), twice(text));
for (const other of [null, 5, ["a", "b"], { length: 2, match: () => null, slice: () => "", substring: () => "" }]) {
  for (const f of [joined, truth, executed, helped, broken, returned, tokens, prefixes, twice]) {
    try {
      console.log(f.name, f(other));
    } catch (error) {
      console.log(f.name, error.constructor.name);
    }
  }
}
