// A value of a union type is used several times in each iteration of a loop that does not change it, so its type can be tested once in front of the loop. Every member of each union arrives, loops run zero times, and close neighbors change the value in the loop.
type Text = string | number[] | undefined;

function lengths(value: string | number[], rounds: number): number {
  let r = 0;
  for (let i = 0; i < rounds; i++) {
    r = (r + value.length) | 0;
    const unit = value[i & 3];
    r = (r + (typeof unit === "string" ? unit.charCodeAt(0) : unit ?? -1)) | 0;
    r ^= value.length << 3;
  }
  return r;
}

function optional(value: Text, rounds: number): string {
  let out = "";
  for (let i = 0; i < rounds; i++) {
    if (value === undefined) out += "-";
    else out += value.length;
    if (typeof value === "string") out += value[i] ?? "?";
    else if (value !== undefined) out += value[i] ?? "!";
  }
  return out;
}

function leavesTheLoop(value: string | number, rounds: number): number {
  let r = 0;
  for (let i = 0; i < rounds; i++) {
    if (typeof value !== "string") return -1 - i - value;
    r += value.length;
    if (typeof value === "string") r += value.charCodeAt(i % value.length);
  }
  return r;
}

function nested(outer: string | number[], inner: number | string, rounds: number): number {
  let r = 0;
  for (let i = 0; i < rounds; i++) {
    r += outer.length;
    for (let j = 0; j < i; j++) {
      r += typeof inner === "string" ? inner.length : inner;
      r += typeof outer === "string" ? outer.charCodeAt(j % outer.length) : outer[j % outer.length];
      r += typeof inner === "number" ? inner * 2 : inner.charCodeAt(0);
    }
  }
  return r;
}

function changesInTheLoop(first: string | number[], second: string | number[], rounds: number): number {
  let value = first;
  let r = 0;
  for (let i = 0; i < rounds; i++) {
    r += value.length;
    if (i % 3 === 1) value = value === first ? second : first;
    r += typeof value === "string" ? value.charCodeAt(0) : value[0];
    r += value.length;
  }
  return r;
}

function changesOnce(value: string | number, rounds: number): string {
  let out = "";
  for (let i = 0; i < rounds; i++) {
    out += typeof value === "string" ? value.length : value + 1;
    if (i === 2) value = typeof value === "string" ? value.length : "n" + value;
    out += typeof value === "string" ? "s" : "n";
  }
  return out;
}

function underHandler(value: string | null, rounds: number): string {
  let out = "";
  for (let i = 0; i < rounds; i++) {
    try {
      out += (value as string).length;
      out += value === null ? "null" : value[i % 2];
    } catch (error) {
      out += (error as Error).constructor.name;
    }
  }
  return out;
}

const texts: (string | number[])[] = ["abcd", "é☃", "", [1, 2, 3, 4, 5], [], [7]];
for (const rounds of [0, 1, 2, 7]) {
  console.log(rounds, texts.map(text => lengths(text, rounds)).join(","));
  console.log(rounds, [...texts, undefined].map(text => optional(text, rounds)).join(","));
  console.log(rounds, ["xy", 5, "z", -0.5].map(value => leavesTheLoop(value, rounds)).join(","));
  console.log(rounds, texts.filter(text => text.length > 0).flatMap(text => [nested(text, 3, rounds), nested(text, "pq", rounds)]).join(","));
  console.log(rounds, changesInTheLoop("ab", [9, 8], rounds), changesInTheLoop([5], "xyz", rounds), changesInTheLoop("a", "bc", rounds));
  console.log(rounds, changesOnce("abc", rounds), changesOnce(4, rounds));
  console.log(rounds, underHandler("ok", rounds), underHandler(null, rounds));
}
