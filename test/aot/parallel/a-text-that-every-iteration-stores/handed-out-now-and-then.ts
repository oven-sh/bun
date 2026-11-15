// A text that a loop grows past 2,048 characters and hands out now and then. Every string that was handed out keeps its characters, whatever the text does afterwards.
const kept: string[] = [];
let failsAt = -1;

function piece(i: number): string {
  if (i === failsAt) throw new RangeError("piece " + i);
  return "<" + i + ">";
}

function everySecond(n: number): string {
  let text = "";
  for (let i = 0; i < n; i++) {
    text += "ab";
    if (i & 1) kept.push(text);
  }
  return text;
}

function everyHundredth(n: number): string {
  let text = "";
  for (let i = 0; i < n; i++) {
    text += i + ",";
    if (i % 100 === 99) kept.push(text);
  }
  return text;
}

function twiceTheSame(n: number): string {
  let text = "";
  for (let i = 0; i < n; i++) {
    text += "xyz";
    if (i % 64 === 63) {
      kept.push(text);
      kept.push(text);
    }
  }
  return text;
}

function beginsAnew(n: number): string {
  let text = "";
  for (let i = 0; i < n; i++) {
    text += piece(i);
    if (i % 50 === 49) kept.push(text);
    if (text.length > 3000) text = "new";
  }
  return text;
}

function failsInTheMiddle(n: number, at: number): string {
  let text = "";
  failsAt = at;
  for (let i = 0; i < n; i++) {
    try {
      text += "before" + i + piece(i) + "behind";
    } catch {
      kept.push(text);
      text += "!";
    }
    if (i % 25 === 24) kept.push(text);
  }
  failsAt = -1;
  return text;
}

function becomesWide(n: number, at: number): string {
  let text = "";
  for (let i = 0; i < n; i++) {
    text += i === at ? "日本" : "ab";
    if (i % 100 === 50) kept.push(text);
  }
  return text;
}

function startsLong(n: number, start: string): string {
  let text = start;
  for (let i = 0; i < n; i++) {
    text += ".";
    if (i % 7 === 6) kept.push(text);
  }
  return text;
}

function inside(n: number): string {
  let all = "";
  for (let i = 0; i < n; i++) {
    let line = "";
    for (let j = 0; j < 900; j++) {
      line += "wor";
      if (j % 300 === 299) kept.push(line);
    }
    all += line.length + ";";
    if (i & 1) kept.push(all);
  }
  return all;
}

function digest(result: string): string {
  let hash = 0;
  let length = 0;
  for (const text of [...kept, result]) {
    length += text.length;
    for (let i = 0; i < text.length; i += 1 + (text.length >> 6)) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
    hash = (Math.imul(hash, 31) + text.length) | 0;
  }
  kept.length = 0;
  return `${hash} ${length}`;
}

// The strings of one text are asked for their characters only after the next texts have grown.
const results: string[] = [];
for (let turn = 0; turn < 4; turn++) {
  console.log(
    digest(everySecond(1500)),
    digest(everyHundredth(1200)),
    digest(twiceTheSame(1400)),
    digest(beginsAnew(2500)),
    digest(failsInTheMiddle(300, 222)),
    digest(becomesWide(1800, 1500)),
    digest(startsLong(600, "start ".repeat(500))),
    digest(inside(12)),
  );
  results.push(everyHundredth(900 + turn));
  results.push(everySecond(1300 + turn));
  results.push(twiceTheSame(1100 + turn));
  results.push(failsInTheMiddle(250, 200 + turn));
  results.push(everyHundredth(1000 + turn));
  kept.push(...results);
  console.log(digest(""));
}
