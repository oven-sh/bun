// The key of a for-in over a list is a text wherever anybody looks at it: stored under itself, compared, joined, used as a key of another object, and deleted under.
function walk(list: unknown[]) {
  const other: Record<string, unknown> = {};
  let text = "";
  for (const i in list) {
    list[i as any] = i;
    other[i] = typeof i;
    text += (i === "1" ? "one" : i + 1) + " " + ((i as any) === 1) + " ";
  }
  return text + JSON.stringify(list) + JSON.stringify(other);
}
function drop(list: unknown[]) {
  for (const i in list) { if (i !== "0") delete list[i as any]; }
  return JSON.stringify(list) + (1 in list) + list.length;
}
function deed() { return walk([10, 20, 30]) + " | " + drop([1, 2, 3]); }
console.log(deed());
for (let round = 0; round < 3; round++) console.log(deed());
