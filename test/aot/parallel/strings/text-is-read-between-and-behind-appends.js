// A text that is built by appending is read, by position and as a whole, in loops between its appends and behind them: each read sees what has been appended so far.
function codes(count, wide) {
  let text = "";
  for (let k = 0; k < count; k++) text += String.fromCharCode((wide && k % 7 === 3 ? 0x4e00 : 65) + (k & 15));
  let sum = 0;
  for (let k = 0; k < text.length; k++) sum = (sum * 31 + text.charCodeAt(k)) | 0;
  return sum + ":" + text.length;
}
function between(count) {
  let text = "";
  let sum = 0;
  for (let k = 0; k < count; k++) {
    text += "ab" + k;
    for (let j = 0; j < text.length; j += 3) sum = (sum + text.charCodeAt(j)) | 0;
  }
  return sum + ":" + text.length;
}
function rarely(count) {
  let text = "";
  let sum = 0;
  for (let k = 0; k < count; k++) {
    text += k;
    let j = k % 50 === 49 ? 0 : text.length;
    while (j < text.length) sum = (sum + text.charCodeAt(j++)) | 0;
  }
  return sum + ":" + text.length;
}
function kept(count) {
  let text = "";
  const seen = [];
  for (let k = 0; k < count; k++) {
    text += String.fromCharCode(97 + (k % 26));
    if (k % 5 === 0) seen.push(text);
    if (k % 5 === 1) seen.push(text, text);
  }
  let same = 0;
  for (let k = 1; k < seen.length; k++) if (seen[k] === seen[k - 1]) same++;
  return seen.join("|").length + ":" + same + ":" + seen[seen.length - 1];
}
function twice(count) {
  let left = "";
  let right = "";
  let sum = 0;
  for (let k = 0; k < count; k++) {
    left += "l" + k;
    right += "r";
    for (let j = 0; j < right.length; j++) sum = (sum + left.charCodeAt(j) + right.charCodeAt(j)) | 0;
  }
  return sum + ":" + left.length + ":" + right.length;
}
function again(rounds, count) {
  let sum = 0;
  for (let r = 0; r < rounds; r++) {
    let text = "";
    for (let k = 0; k < count + r; k++) text += String.fromCharCode(48 + ((k + r) % 10));
    for (let k = 0; k < text.length; k++) sum = (sum + text.charCodeAt(k) * (k + 1)) | 0;
    if (r % 3 === 0) text += "tail";
    for (let k = text.length - 1; k >= 0; k -= 2) sum = (sum ^ text.charCodeAt(k)) | 0;
  }
  return sum;
}
for (let round = 0; round < 3; round++) {
  for (const count of [0, 1, 2, 15, 16, 17, 64, 1000, 70000]) console.log(count, codes(count, false), codes(count, true));
  for (const count of [0, 1, 7, 200]) console.log(count, between(count), rarely(count * 10), kept(count), twice(count), again(count % 9, count));
}
