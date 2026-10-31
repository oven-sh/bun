// The length of a named group that took no part.
function size(s: string): number {
  return s.length;
}

function named(pattern: RegExp, text: string): string {
  const groups = pattern.exec(text)?.groups;
  return groups === undefined ? "no groups" : groups.name;
}

console.log(size(named(/(?<name>a)b/, "ab")));
try {
  console.log(size(named(/(?<name>a)?b/, "b")));
} catch (error) {
  console.log(error instanceof TypeError);
}
