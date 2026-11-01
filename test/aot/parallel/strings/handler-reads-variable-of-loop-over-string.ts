// A loop in a try block reads characters of a string, and the catch or finally block reads a variable that the loop changes. The build verifies the program after every stage.
// Flags: --aot-check=verify-each-stage
// Env of the executable: BUN_JSC_validateAOTRuntime=1
function replacedInFinally(a: number): number {
  let s: string = String(a);
  const t: string = String(a + 1);
  try {
    if (a & 1) {
      try {
        let c = 1;
        do {
          s = t.slice(1) + "q";
        } while (--c > 0);
      } finally {
      }
    }
  } catch (thrown) {}
  return s.length;
}
console.log(replacedInFinally(1), replacedInFinally(2));

function countedInCatch(s: string, limit: number): number {
  let n = 0;
  try {
    for (let i = 0; i < s.length; i++) {
      if (s.charCodeAt(i) === 97) n++;
      if (n > limit) throw new Error("many");
    }
  } catch (error) {
    return -n;
  }
  return n;
}
const text: string = ("abc".repeat(30) + "x").slice(1);
console.log(countedInCatch(text, 1000), countedInCatch(text, 10), countedInCatch("", 0));

function readAfterTheTry(s: string, limit: number): string {
  let n = 0, last = "";
  try {
    for (let i = 0; i < s.length; i++) {
      last = s[i];
      if (++n > limit) throw new Error("many");
    }
  } catch {}
  return n + last;
}
console.log(readAfterTheTry(text, 1000), readAfterTheTry(text, 4), readAfterTheTry("", 0));

function twoLoops(s: string, t: string, limit: number): number {
  let n = 0;
  try {
    for (let i = 0; i < s.length; i++) {
      for (let k = 0; k < t.length; k++) {
        if (s.charCodeAt(i) === t.charCodeAt(k)) n++;
        if (n > limit) throw new Error("many");
      }
    }
  } catch {
    n = -n;
  } finally {
    n *= 2;
  }
  return n;
}
console.log(twoLoops(text, "ab", 1000), twoLoops(text, "ab", 7));
