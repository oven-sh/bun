function show(...parts: (string | number | undefined)[]): string {
  return JSON.stringify(parts.map(part => (part === undefined ? "<undefined>" : part)));
}

function commaThree(s: string): string { const [a, b, c] = s.split(","); return show(a, b, c); }
function commaFirst(s: string): string { return show(s.split(",")[0]); }
function commaLength(s: string): string { return show(s.split(",").length); }
function commaSecondAndLength(s: string): string { const parts = s.split(","); return show(parts[1], parts.length); }

function spacedThree(s: string): string { const [a, b, c] = s.split(", "); return show(a, b, c); }
function spacedFirst(s: string): string { return show(s.split(", ")[0]); }
function spacedLength(s: string): string { return show(s.split(", ").length); }
function spacedSecondAndLength(s: string): string { const parts = s.split(", "); return show(parts[1], parts.length); }

function longThree(s: string): string { const [a, b, c] = s.split("<<--separator-->>"); return show(a, b, c); }
function longFirst(s: string): string { return show(s.split("<<--separator-->>")[0]); }
function longLength(s: string): string { return show(s.split("<<--separator-->>").length); }
function longSecondAndLength(s: string): string { const parts = s.split("<<--separator-->>"); return show(parts[1], parts.length); }

function accentThree(s: string): string { const [a, b, c] = s.split("é"); return show(a, b, c); }
function accentFirst(s: string): string { return show(s.split("é")[0]); }
function accentLength(s: string): string { return show(s.split("é").length); }
function accentSecondAndLength(s: string): string { const parts = s.split("é"); return show(parts[1], parts.length); }

function emptyThree(s: string): string { const [a, b, c] = s.split(""); return show(a, b, c); }
function emptyFirst(s: string): string { return show(s.split("")[0]); }
function emptyLength(s: string): string { return show(s.split("").length); }
function emptySecondAndLength(s: string): string { const parts = s.split(""); return show(parts[1], parts.length); }

function parameterThree(s: string, x: string): string { const [a, b, c] = s.split(x); return show(a, b, c); }
function parameterFirst(s: string, x: string): string { return show(s.split(x)[0]); }
function parameterLength(s: string, x: string): string { return show(s.split(x).length); }
function parameterSecondAndLength(s: string, x: string): string { const parts = s.split(x); return show(parts[1], parts.length); }

function overlappingThree(s: string): string { const [a, b, c] = s.split("aa"); return show(a, b, c); }
function overlappingLength(s: string): string { return show(s.split("aa").length); }

function escaped(s: string, x: string): string[] { return s.split(x); }
function lastByAt(s: string): string { const parts = s.split(","); return show(parts.at(-1)); }
function iterated(s: string): string {
  let out = "";
  for (const part of s.split(",")) out += "[" + part + "]";
  return out;
}
function limited(s: string): string { const parts = s.split(",", 2); return show(parts[0], parts[1], parts[2], parts.length); }

const forms: [string, ((s: string) => string)[]][] = [
  [",", [commaThree, commaFirst, commaLength, commaSecondAndLength]],
  [", ", [spacedThree, spacedFirst, spacedLength, spacedSecondAndLength]],
  ["<<--separator-->>", [longThree, longFirst, longLength, longSecondAndLength]],
  ["é", [accentThree, accentFirst, accentLength, accentSecondAndLength]],
  ["", [emptyThree, emptyFirst, emptyLength, emptySecondAndLength]],
];

function subjectsFor(x: string): string[] {
  const joined = (count: number): string => {
    let text = "p0";
    for (let i = 1; i <= count; i++) text += x + "p" + i;
    return text;
  };
  const exact = joined(3);
  return [
    "",
    "nothing here",
    joined(2),
    exact,
    joined(6),
    joined(3) + x,
    x + joined(1),
    x,
    x + x,
    joined(2) + x + String(exact.length),
    ("<<" + exact + ">>").slice(2, -2),
    exact.substring(1),
    "日本" + x + "語" + x + "文" + x + "字",
    ("日本" + x + "語" + x + "文").slice(1),
  ];
}

for (const [x, group] of forms) {
  for (const subject of subjectsFor(x)) {
    const answers = group.map(form => form(subject));
    const byParameter = [parameterThree(subject, x), parameterFirst(subject, x), parameterLength(subject, x), parameterSecondAndLength(subject, x)];
    console.log(JSON.stringify(x), JSON.stringify(subject), answers.join(" "), byParameter.join(" "));
    console.log(JSON.stringify(escaped(subject, x)), lastByAt(subject), iterated(subject), limited(subject));
  }
}

for (const subject of ["aaa", "aaaa", "aaaaa", "baab", "a", ""]) {
  console.log(JSON.stringify(subject), overlappingThree(subject), overlappingLength(subject), parameterThree(subject, "aa"), JSON.stringify(escaped(subject, "aa")));
}

export {};
