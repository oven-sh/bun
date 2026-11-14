const noted: string[] = [];
function tell(value: unknown): string {
  return typeof value === "number" && Object.is(value, -0) ? "-0" : typeof value + ":" + String(value);
}
const values: any[] = [0, -0, 1, -1, 7, 2147483647, -2147483648, 2147483648, -2147483649, 4294967296, 0.5, -0.5, NaN, Infinity, -Infinity, "10", "9", "abc", "", " 12 ", undefined, null, true, false, 10n, -1n, { valueOf() { noted.push("a"); return 3; } }, { toString() { noted.push("b"); return "4"; } }, { valueOf() { noted.push("c"); return 2n; } }, [5], Symbol("odd")];
function ask(left: any, right: any): any {
  return !(left >= right) ? "not" : "so";
}
(globalThis as any).ask = ask;
for (let i = 0; i < values.length; i++) {
  let line = "";
  for (let j = 0; j < values.length; j++) {
    try {
      line += tell(ask(values[i], values[j])) + " ";
    } catch (error) {
      line += (error as Error).name + " ";
    }
  }
  console.log(i + ": " + line + noted.join(""));
  noted.length = 0;
}
