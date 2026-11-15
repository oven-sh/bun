// A text that a loop grows and hands out on every way through an iteration, in several arms, and twins in which some way hands nothing out or reads characters.
const kept: string[] = [];
const lengths: number[] = [];
let last = "";
const words = ["ab", "c", "", "déf", "g", "日本", "hi", "jkl"];
const flags = [true, false, false, true, true, false, true, false];

function keep(text: string): void {
  kept.push(text);
}

function measure(text: string): number {
  lengths.push(text.length);
  return text.length;
}

function ifElse(n: number): string {
  let text = "";
  for (let i = 0; i < n; i++) {
    text += words[i & 7];
    if (flags[i & 7]) keep(text);
    else last = text;
  }
  return text;
}

function ternary(n: number): number {
  let text = "";
  let sum = 0;
  for (let i = 0; i < n; i++) {
    text += words[i & 7];
    sum += flags[i & 7] ? measure(text) : kept.push(text);
  }
  return sum + text.length;
}

function chain(n: number): string {
  let text = "";
  for (let i = 0; i < n; i++) {
    text += words[i & 7];
    if (i % 3 === 0) keep(text);
    else if (i % 3 === 1) last = text;
    else kept[i & 3] = text;
  }
  return text;
}

function choice(n: number): string {
  let text = "";
  for (let i = 0; i < n; i++) {
    text += words[i & 7];
    switch (i & 3) {
      case 0:
        keep(text);
        break;
      case 1:
        last = text;
        break;
      default:
        measure(text);
    }
  }
  return text;
}

function goesOnInAnArm(n: number): string {
  let text = "";
  for (let i = 0; i < n; i++) {
    text += words[i & 7];
    if (flags[i & 7]) {
      keep(text);
      continue;
    }
    last = text;
  }
  return text;
}

function leavesInAnArm(n: number, limit: number): string {
  let text = "";
  for (let i = 0; i < n; i++) {
    text += words[i & 7];
    if (text.length > limit) break;
    keep(text);
  }
  return text;
}

function throwsInAnArm(n: number, limit: number): string {
  let text = "";
  try {
    for (let i = 0; i < n; i++) {
      text += words[i & 7];
      if (i === limit) throw new Error(text);
      if (flags[i & 7]) keep(text);
      else measure(text);
    }
  } catch (error) {
    return (error as Error).message + "!" + text;
  }
  return text;
}

function catchesInTheLoop(n: number): string {
  let text = "";
  for (let i = 0; i < n; i++) {
    text += words[i & 7];
    try {
      if (i % 5 === 4) throw i;
      keep(text);
    } catch {
      last = text;
    }
  }
  return text;
}

function growsBetweenTheStores(n: number): string {
  let text = "";
  for (let i = 0; i < n; i++) {
    text += words[i & 7];
    if (flags[i & 7]) keep(text);
    else last = text;
    text += ";";
  }
  return text;
}

function growsInTheArms(n: number): string {
  let text = "";
  for (let i = 0; i < n; i++) {
    if (flags[i & 7]) {
      text += words[i & 7];
      keep(text);
    } else {
      text += "-";
      last = text;
    }
  }
  return text;
}

// Twins: one way hands nothing out, one reads characters, one begins anew, one hands out in a loop inside.
function oneArmOnly(n: number): string {
  let text = "";
  for (let i = 0; i < n; i++) {
    text += words[i & 7];
    if (flags[i & 7]) keep(text);
  }
  return text;
}

function readsCharacters(n: number): number {
  let text = "";
  let sum = 0;
  for (let i = 0; i < n; i++) {
    text += words[i & 7];
    if (flags[i & 7]) keep(text);
    else last = text;
    sum += text.length ? text[text.length - 1].length + (text.endsWith("kl") ? 1 : 0) : 0;
  }
  return sum;
}

function beginsAnew(n: number): string {
  let text = "";
  for (let i = 0; i < n; i++) {
    text += words[i & 7];
    if (flags[i & 7]) {
      keep(text);
      text = "";
    } else last = text;
  }
  return text;
}

function storesInALoopInside(n: number): string {
  let text = "";
  for (let i = 0; i < n; i++) {
    text += words[i & 7];
    for (let j = 0; j < (i & 3); j++) {
      if (flags[j]) keep(text);
      else measure(text);
    }
  }
  return text;
}

function digest(value: unknown): string {
  let hash = 0;
  for (const text of [...kept, last, String(value)]) {
    for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
    hash = (Math.imul(hash, 31) + text.length) | 0;
  }
  const sum = lengths.reduce((before, length) => (Math.imul(before, 7) + length) | 0, 0);
  const result = `${hash} ${sum} ${kept.length} ${last.length} ${typeof value === "string" ? value.length : value}`;
  kept.length = 0;
  lengths.length = 0;
  last = "";
  return result;
}

for (const n of [0, 1, 2, 7, 40, 300]) {
  for (let turn = 0; turn < 3; turn++) {
    console.log(
      n,
      digest(ifElse(n)),
      digest(ternary(n)),
      digest(chain(n)),
      digest(choice(n)),
      digest(goesOnInAnArm(n)),
      digest(leavesInAnArm(n, 50)),
      digest(throwsInAnArm(n, 30)),
      digest(catchesInTheLoop(n)),
      digest(growsBetweenTheStores(n)),
      digest(growsInTheArms(n)),
    );
    console.log(
      n,
      digest(oneArmOnly(n)),
      digest(readsCharacters(n)),
      digest(beginsAnew(n)),
      digest(storesInALoopInside(n)),
    );
  }
}
