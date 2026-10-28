function uses(pattern: RegExp, text: string): string {
  return pattern.test(text) + ":" + pattern.lastIndex;
}

function fail(really: boolean): void {
  if (really) throw new Error("failed");
}

const turns = process.argv.length > 99 ? 4 : 3;

function run(text: string): string {
  let seen = "";
  for (let turn = 0; turn < turns; turn++) {
    try {
      fail(turn !== 1);
      seen += "quiet ";
    } catch {
      seen += uses(/(?<first>a)/dg, text) + " ";
    }
  }
  return seen;
}

console.log(run("aXbaaXab1"));
console.log(run("aXbaaXab2"));
