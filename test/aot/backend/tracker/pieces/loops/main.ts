// Inner loops of encoders, decoders, scanners and buffer writers.
//   main.ts <copy | field | rare | escape | scan | scan32 | closure | closure32 | sum> <rounds>
// One round is one pass over a 4,096-character ASCII string. Run `perf stat -e instructions:u` with two round counts;
// the difference divided by (rounds * 4096) is instructions per character. main.go and main.rs are the same kernels.
import type { int32 } from "bun";

const text = Array.from({ length: 4096 }, (_, i) => "the quick brown fox jumps over the lazy dog, again & again. "[i % 60]).join("");
const bytes = new Uint8Array(8192);

function copy(text: string, bytes: Uint8Array): number {
  const n = text.length;
  let at = 0;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes[at++] = c;
  }
  return at;
}

function escape(text: string, bytes: Uint8Array): number {
  const n = text.length;
  let at = 0;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c === 38) {
      bytes[at++] = 38;
      bytes[at++] = 97;
      bytes[at++] = 109;
      bytes[at++] = 112;
      bytes[at++] = 59;
    } else if (c !== 60 && c !== 62 && c !== 34 && c !== 39) {
      bytes[at++] = c;
    }
  }
  return at;
}

function scan(text: string): number {
  let found = 0;
  let at = 0;
  while (at < text.length) {
    const character = text[at];
    if (character === "`" || character === "*" || character === "[" || character === "@" || character === "#") found++;
    at++;
  }
  return found + at;
}

function scan32(text: string): number {
  let found: int32 = 0;
  let at: int32 = 0;
  while (at < text.length) {
    const character = text[at];
    if (character === "`" || character === "*" || character === "[" || character === "@" || character === "#") found = (found + 1) | 0;
    at++;
  }
  return found + at;
}

// `copy` as a method of a buffer writer: the write offset is loaded from a field and stored back.
class Out {
  bytes = new Uint8Array(8192);
  length = 0;

  field(text: string): void {
    const n = text.length;
    const bytes = this.bytes;
    let at = this.length;
    for (let i = 0; i < n; i++) {
      const c = text.charCodeAt(i);
      if (c < 0x80) bytes[at++] = c;
    }
    this.length = at;
  }

  wide(text: string, i: number): number {
    this.bytes[this.length++] = 63;
    return text.charCodeAt(i) >= 0xd800 ? 2 : 1;
  }

  // `field` plus a call on the non-ASCII branch, which never executes with this input.
  rare(text: string): void {
    const n = text.length;
    const bytes = this.bytes;
    let at = this.length;
    for (let i = 0; i < n; i++) {
      const c = text.charCodeAt(i);
      if (c < 0x80) {
        bytes[at++] = c;
      } else {
        this.length = at;
        i += this.wide(text, i) - 1;
        at = this.length;
      }
    }
    this.length = at;
  }
}
const out = new Out();

// `scan` plus a closure that assigns the index, as hand-written parsers do. The input has no backtick, so it is never called.
function closure(text: string): number {
  let found = 0;
  let at = 0;
  const jump = (end: number) => {
    found++;
    at = end;
  };
  while (at < text.length) {
    if (text[at] === "`") {
      const close = text.indexOf("`", at + 1);
      if (close > at + 1) {
        jump(close + 1);
        continue;
      }
    }
    at++;
  }
  return found + at;
}

function closure32(text: string): number {
  let found: int32 = 0;
  let at: int32 = 0;
  const jump = (end: int32) => {
    found = (found + 1) | 0;
    at = end;
  };
  while (at < text.length) {
    if (text[at] === "`") {
      const close = text.indexOf("`", at + 1);
      if (close > at + 1) {
        jump((close + 1) | 0);
        continue;
      }
    }
    at = (at + 1) | 0;
  }
  return found + at;
}

function sum(bytes: Uint8Array): number {
  let total = 0;
  for (let i = 0; i < 4096; i++) total += bytes[i]!;
  return total;
}

const [kernel = "", rounds = "1"] = process.argv.slice(2);
let result = 0;
for (let round = Number(rounds); round > 0; round--) {
  if (kernel === "copy") result = copy(text, bytes);
  else if (kernel === "escape") result = escape(text, bytes);
  else if (kernel === "scan") result = scan(text);
  else if (kernel === "scan32") result = scan32(text);
  else if (kernel === "closure") result = closure(text);
  else if (kernel === "closure32") result = closure32(text);
  else if (kernel === "field") {
    out.length = 0;
    out.field(text);
    result = out.length;
  } else if (kernel === "rare") {
    out.length = 0;
    out.rare(text);
    result = out.length;
  }
  else result = sum(bytes);
}
console.log(kernel, result);
