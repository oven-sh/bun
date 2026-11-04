// a text is searched whose written type lists short texts alone, and a longer text arrives
type Short = "ab" | "cd";
function place(s: Short) { return s.indexOf("abc"); }
function begins(s: Short) { return s.startsWith("abc"); }
function holds(s: Short) { return s.includes("bcd") + ":" + s.lastIndexOf("bcd") + ":" + s.endsWith("bcd"); }
function tested(s: string) { return s === "ab" || s === "cd" ? s.indexOf("abc") + ":" + s.indexOf("b") : "other"; }
const arrived: string[] = JSON.parse('["ab", "cd", "abc", "xabcd", ""]');
for (let turn = 0; turn < 3; turn++) {
  for (let i = 0; i < arrived.length; i++)
    console.log(arrived[i], place(arrived[i] as any), begins(arrived[i] as any), holds(arrived[i] as any), tested(arrived[i]));
}
