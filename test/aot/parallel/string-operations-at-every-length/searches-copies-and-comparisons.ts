// Vector code of strings at every length and position. The characters sought lie in front of, at and behind the position.
const letters = "abcdeqabcdefghijklmnopqrstuvwxyzabcdeqabcdefqhijklmnopqrstuvwxyzabcdefghijq";
const table = new Map(Array.from(letters, (_, i) => [letters.slice(i), i] as const));

function hash(text: string): number {
  let h = 7;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 33) + text.charCodeAt(i)) | 0;
  return h;
}

function make(kind: string, length: number): string {
  switch (kind) {
    case "accented":
      return "\u00e9" + letters.slice(0, length);
    case "wide":
      return "\u4f60" + letters.slice(0, length);
    case "piece":
      return ("zzzzz" + letters).substring(5, 5 + length);
    case "unaligned":
      return ("z".repeat(length % 17) + letters).slice(length % 17, (length % 17) + length);
    case "rope":
      return letters.slice(0, length >> 1) + letters.slice(length >> 1, length);
    default:
      return letters.slice(0, length);
  }
}

function indexOfCharacter(s: string, p: number): number {
  return s.indexOf("q", p);
}
function lastIndexOfCharacter(s: string, p: number): number {
  return s.lastIndexOf("q", p);
}
function lastIndexOfFrequent(s: string, p: number): number {
  return s.lastIndexOf("a", p);
}
function indexOfPair(s: string, p: number): number {
  return s.indexOf("qa", p);
}
function lastIndexOfPair(s: string, p: number): number {
  return s.lastIndexOf("qa", p);
}
function indexOfFive(s: string, p: number): number {
  return s.indexOf("abcde", p);
}
function lastIndexOfFive(s: string, p: number): number {
  return s.lastIndexOf("abcde", p);
}
function includesThree(s: string, p: number): number {
  return s.includes("cde", p) ? 1 : 0;
}
function indexOfAccented(s: string, p: number): number {
  return s.indexOf("\u00e9", p);
}
function lastIndexOfWide(s: string, p: number): number {
  return s.lastIndexOf("\u4f60", p);
}
function startsWith(s: string, p: number): number {
  return s.startsWith("cd", p) ? 1 : 0;
}
function endsWith(s: string, p: number): number {
  return s.endsWith("cd", p) ? 1 : 0;
}
function slice(s: string, p: number): number {
  return hash(s.slice(p));
}
function sliceFromEnd(s: string, p: number): number {
  return hash(s.slice(-p, -1));
}
function equals(s: string, p: number): number {
  return s === letters.slice(0, p) ? 1 : 0;
}
function less(s: string, p: number): number {
  return s < letters.slice(p) ? 1 : 0;
}
function split(s: string, p: number): number {
  return hash(s.split("q").join("-"));
}
function replace(s: string, p: number): number {
  return hash(s.replace("q", String(p)));
}
function replaceAll(s: string, p: number): number {
  return hash(s.replaceAll(letters[p & 7], "-"));
}
function upperCase(s: string, p: number): number {
  return hash(s.toUpperCase()) + p;
}
function pad(s: string, p: number): number {
  return hash(s.padStart(p, "xy"));
}
function concat(s: string, p: number): number {
  return hash(s + letters.slice(p));
}
function matchCount(s: string, p: number): number {
  return (s.match(/[a-c]+/g) ?? []).length;
}
function lookUp(s: string, p: number): number {
  return table.get(s.slice(p)) ?? -1;
}
function afterLast(s: string, p: number): number {
  return hash(s.slice(s.lastIndexOf("q", p) + 1));
}
function utf8Length(s: string, p: number): number {
  return new TextEncoder().encode(s).length + p;
}

const next = (position: number) => position + (position < 20 ? 1 : 3);

for (const kind of ["latin", "accented", "wide", "piece", "unaligned", "rope"]) {
  {
    let h = 0;
    for (let length = 0; length <= 72; length++) {
      const s = make(kind, length);
      for (let p = -1; p <= 76; p = next(p)) h = (Math.imul(h, 31) + indexOfCharacter(s, p)) | 0;
    }
    console.log(kind, "indexOfCharacter", h);
  }
  {
    let h = 0;
    for (let length = 0; length <= 72; length++) {
      const s = make(kind, length);
      for (let p = -1; p <= 76; p = next(p)) h = (Math.imul(h, 31) + lastIndexOfCharacter(s, p)) | 0;
    }
    console.log(kind, "lastIndexOfCharacter", h);
  }
  {
    let h = 0;
    for (let length = 0; length <= 72; length++) {
      const s = make(kind, length);
      for (let p = -1; p <= 76; p = next(p)) h = (Math.imul(h, 31) + lastIndexOfFrequent(s, p)) | 0;
    }
    console.log(kind, "lastIndexOfFrequent", h);
  }
  {
    let h = 0;
    for (let length = 0; length <= 72; length++) {
      const s = make(kind, length);
      for (let p = -1; p <= 76; p = next(p)) h = (Math.imul(h, 31) + indexOfPair(s, p)) | 0;
    }
    console.log(kind, "indexOfPair", h);
  }
  {
    let h = 0;
    for (let length = 0; length <= 72; length++) {
      const s = make(kind, length);
      for (let p = -1; p <= 76; p = next(p)) h = (Math.imul(h, 31) + lastIndexOfPair(s, p)) | 0;
    }
    console.log(kind, "lastIndexOfPair", h);
  }
  {
    let h = 0;
    for (let length = 0; length <= 72; length++) {
      const s = make(kind, length);
      for (let p = -1; p <= 76; p = next(p)) h = (Math.imul(h, 31) + indexOfFive(s, p)) | 0;
    }
    console.log(kind, "indexOfFive", h);
  }
  {
    let h = 0;
    for (let length = 0; length <= 72; length++) {
      const s = make(kind, length);
      for (let p = -1; p <= 76; p = next(p)) h = (Math.imul(h, 31) + lastIndexOfFive(s, p)) | 0;
    }
    console.log(kind, "lastIndexOfFive", h);
  }
  {
    let h = 0;
    for (let length = 0; length <= 72; length++) {
      const s = make(kind, length);
      for (let p = -1; p <= 76; p = next(p)) h = (Math.imul(h, 31) + includesThree(s, p)) | 0;
    }
    console.log(kind, "includesThree", h);
  }
  {
    let h = 0;
    for (let length = 0; length <= 72; length++) {
      const s = make(kind, length);
      for (let p = -1; p <= 76; p = next(p)) h = (Math.imul(h, 31) + indexOfAccented(s, p)) | 0;
    }
    console.log(kind, "indexOfAccented", h);
  }
  {
    let h = 0;
    for (let length = 0; length <= 72; length++) {
      const s = make(kind, length);
      for (let p = -1; p <= 76; p = next(p)) h = (Math.imul(h, 31) + lastIndexOfWide(s, p)) | 0;
    }
    console.log(kind, "lastIndexOfWide", h);
  }
  {
    let h = 0;
    for (let length = 0; length <= 72; length++) {
      const s = make(kind, length);
      for (let p = -1; p <= 76; p = next(p)) h = (Math.imul(h, 31) + startsWith(s, p)) | 0;
    }
    console.log(kind, "startsWith", h);
  }
  {
    let h = 0;
    for (let length = 0; length <= 72; length++) {
      const s = make(kind, length);
      for (let p = -1; p <= 76; p = next(p)) h = (Math.imul(h, 31) + endsWith(s, p)) | 0;
    }
    console.log(kind, "endsWith", h);
  }
  {
    let h = 0;
    for (let length = 0; length <= 72; length++) {
      const s = make(kind, length);
      for (let p = -1; p <= 76; p = next(p)) h = (Math.imul(h, 31) + slice(s, p)) | 0;
    }
    console.log(kind, "slice", h);
  }
  {
    let h = 0;
    for (let length = 0; length <= 72; length++) {
      const s = make(kind, length);
      for (let p = -1; p <= 76; p = next(p)) h = (Math.imul(h, 31) + sliceFromEnd(s, p)) | 0;
    }
    console.log(kind, "sliceFromEnd", h);
  }
  {
    let h = 0;
    for (let length = 0; length <= 72; length++) {
      const s = make(kind, length);
      for (let p = -1; p <= 76; p = next(p)) h = (Math.imul(h, 31) + equals(s, p)) | 0;
    }
    console.log(kind, "equals", h);
  }
  {
    let h = 0;
    for (let length = 0; length <= 72; length++) {
      const s = make(kind, length);
      for (let p = -1; p <= 76; p = next(p)) h = (Math.imul(h, 31) + less(s, p)) | 0;
    }
    console.log(kind, "less", h);
  }
  {
    let h = 0;
    for (let length = 0; length <= 72; length++) {
      const s = make(kind, length);
      for (let p = -1; p <= 76; p = next(p)) h = (Math.imul(h, 31) + split(s, p)) | 0;
    }
    console.log(kind, "split", h);
  }
  {
    let h = 0;
    for (let length = 0; length <= 72; length++) {
      const s = make(kind, length);
      for (let p = -1; p <= 76; p = next(p)) h = (Math.imul(h, 31) + replace(s, p)) | 0;
    }
    console.log(kind, "replace", h);
  }
  {
    let h = 0;
    for (let length = 0; length <= 72; length++) {
      const s = make(kind, length);
      for (let p = -1; p <= 76; p = next(p)) h = (Math.imul(h, 31) + replaceAll(s, p)) | 0;
    }
    console.log(kind, "replaceAll", h);
  }
  {
    let h = 0;
    for (let length = 0; length <= 72; length++) {
      const s = make(kind, length);
      for (let p = -1; p <= 76; p = next(p)) h = (Math.imul(h, 31) + upperCase(s, p)) | 0;
    }
    console.log(kind, "upperCase", h);
  }
  {
    let h = 0;
    for (let length = 0; length <= 72; length++) {
      const s = make(kind, length);
      for (let p = -1; p <= 76; p = next(p)) h = (Math.imul(h, 31) + pad(s, p)) | 0;
    }
    console.log(kind, "pad", h);
  }
  {
    let h = 0;
    for (let length = 0; length <= 72; length++) {
      const s = make(kind, length);
      for (let p = -1; p <= 76; p = next(p)) h = (Math.imul(h, 31) + concat(s, p)) | 0;
    }
    console.log(kind, "concat", h);
  }
  {
    let h = 0;
    for (let length = 0; length <= 72; length++) {
      const s = make(kind, length);
      for (let p = -1; p <= 76; p = next(p)) h = (Math.imul(h, 31) + matchCount(s, p)) | 0;
    }
    console.log(kind, "matchCount", h);
  }
  {
    let h = 0;
    for (let length = 0; length <= 72; length++) {
      const s = make(kind, length);
      for (let p = -1; p <= 76; p = next(p)) h = (Math.imul(h, 31) + lookUp(s, p)) | 0;
    }
    console.log(kind, "lookUp", h);
  }
  {
    let h = 0;
    for (let length = 0; length <= 72; length++) {
      const s = make(kind, length);
      for (let p = -1; p <= 76; p = next(p)) h = (Math.imul(h, 31) + afterLast(s, p)) | 0;
    }
    console.log(kind, "afterLast", h);
  }
  {
    let h = 0;
    for (let length = 0; length <= 72; length++) {
      const s = make(kind, length);
      for (let p = -1; p <= 76; p = next(p)) h = (Math.imul(h, 31) + utf8Length(s, p)) | 0;
    }
    console.log(kind, "utf8Length", h);
  }
}
