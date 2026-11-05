// a comment is skipped: the flags are a fraction
const said: string[] = [];
function show(value: any): string { return Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "string" ? JSON.stringify(value) : typeof value === "object" && value ? "an object" : String(value); }
function create() {
  var text: string; var pos: number; var end: number; var flags: number; var lines = 0;
  const hooked = (0, eval)("(made) => {}");
  function hook() { hooked(made); }
  function at(p: number) { return text.charCodeAt(p); }
  function bump() { pos++; }
  function work(): any { let fuel = 0; while (pos < end) { if (++fuel > 60) break;  const ch = at(pos); if (ch === 42 && at(pos + 1) === 47) { pos += 2; break; } pos++; if (ch === 10) { flags |= 1; lines++; } } return pos; }
  function set(t: any, p: any, e: any, f: any) { text = t; pos = p; end = e; flags = f; }
  return { work, set, bump, peek: () => pos, poke: (value: any) => { pos = value; }, bound: (value: any) => { end = value; }, all: () => [pos, end, flags, lines].map(show).join(" ") };
}
const made = create();
(globalThis as any).keptOutside = made;
for (const state of [() => made.set("ab*c\nde * f*/ tail", 0, 19, 0), () => made.set("ab*c\nde * f*/ tail", 0, 19, 0.5), () => made.set("ab*c\nde * f*/ tail", 0, 19, 0)]) {
  state();
  try {
    console.log(show(made.work()));
  } catch (error) {
    console.log("thrown: " + (error as Error).name);
  }
  console.log(made.all());
}
console.log(said.join(", "));
export {};
