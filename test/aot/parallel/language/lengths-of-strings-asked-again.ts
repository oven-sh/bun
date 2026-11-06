// The length of a string asked again and again, between calls, appends and branches, and the lengths of strings that are one of a few written ones.
const out: string[] = [];
const seen: string[] = [];
function sort(name: string): number {
  if (name.length > 12) seen.push(name + "!");
  else if (name.length > 6) seen.push(name.slice(1));
  else if (name.length > 3) seen.push(name.toUpperCase());
  return name.length + seen.length;
}
function grows(text: string, n: number): string {
  let lengths = "";
  for (let k = 0; k < n; k++) { lengths += text.length + ","; text += text.length > 4 ? "x" : "yy"; lengths += text.length + ";"; }
  return lengths;
}
type Kind = "a" | "bcd" | "efghij";
function kind(k: Kind): string { return k.length > 5 ? "long" : k.length > 2 ? "middle" : k.length > 0 ? "short" : "none"; }
function either(a: string, b: string, first: boolean): number { const s = first ? a : b; return s.length * 100 + (first ? a.length : b.length) + s.length; }
function caught(s: string | undefined): string { try { return String(s!.length) + s!.length; } catch (e) { return (e as Error).constructor.name; } }
for (const name of ["", "abc", "abcd", "abcdefg", "abcdefghijklm", "é😀", ["ro", "pe"].join("") + String(seen.length)]) out.push(`${name.length} ${sort(name)}`);
out.push(seen.join("|"), grows("", 6), grows("abcd", 3));
for (const k of ["a", "bcd", "efghij"] as Kind[]) out.push(kind(k));
out.push(String(either("ab", "cdef", true)), String(either("ab", "cdef", false)), caught("xy"), caught(undefined));
console.log(out.join("\n"));
