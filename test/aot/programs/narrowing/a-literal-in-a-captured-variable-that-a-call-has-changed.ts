// The checker keeps what an assignment has told it across a call: to it the variable still holds the literal that was stored. The call has stored another one.
// Every use below has to see the value that is there.
const table = { a: 1, b: 2 };
const list = ["zero", "one"];

function pick(word: "a" | "b"): string {
  return word === "a" ? "first" : "second";
}

function double(count: 0 | 1): number {
  return count * 2;
}

function run(): string {
  let heldWord: "a" | "b" = "a";
  let heldCount: 0 | 1 = 0;
  let heldFlag = false;
  let heldMaybe: number | undefined = undefined;
  const change = (): void => {
    heldWord = "b";
    heldCount = 1;
    heldFlag = true;
    heldMaybe = 7;
  };
  const lines: unknown[] = [];
  heldWord = "a";
  change();
  lines.push(table[heldWord], heldWord + "!", `<${heldWord}>`, heldWord.charCodeAt(0), [heldWord].join(), pick(heldWord), heldWord.toUpperCase(), heldWord < "b");
  const word: string = heldWord;
  lines.push(word, word === "b", typeof heldWord);
  heldCount = 0;
  change();
  lines.push(list[heldCount], heldCount + 1, heldCount * 2, -heldCount, heldCount ? "yes" : "no", String(heldCount), double(heldCount), heldCount | 4, heldCount < 1);
  const count: number = heldCount;
  lines.push(count, count === 1, [10, 20][heldCount]);
  heldFlag = false;
  change();
  lines.push(heldFlag ? 1 : 2, !heldFlag, heldFlag && "x", String(heldFlag), heldFlag || "y", Number(heldFlag));
  if (heldFlag) lines.push("taken");
  else lines.push("not taken");
  const flag: boolean = heldFlag;
  lines.push(flag, flag ? "set" : "clear");
  heldMaybe = undefined;
  change();
  lines.push(heldMaybe === undefined ? "none" : "some", typeof heldMaybe, String(heldMaybe), [heldMaybe].length, heldMaybe == null);
  const maybe: number | undefined = heldMaybe;
  lines.push(maybe, maybe === 7);
  return lines.map(String).join(" ");
}

for (let turn = 0; turn < 3; turn++) console.log(run());
