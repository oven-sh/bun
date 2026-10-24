// A value that the compiler can prove is never a string is compared with a string literal, in every form a comparison takes. Every line is what plain Bun prints.
function isY(value: any): boolean { return value === "y"; }
function isNotY(value: any): boolean { return value !== "y"; }
function literalFirst(value: any): string { return "longer text" === value ? "equal" : "different"; }
function chained(value: any): string { if (value === "a") return "a"; else if (value === "b") return "b"; return "neither"; }
function switched(value: any): string { switch (value) { case "a": return "a"; case "b": return "b"; default: return "neither"; } }
const values: any[] = [undefined, null, true, 1, 1.5, 10n, Symbol.iterator, { a: 1 }, [1], () => 1];
for (const check of [isY, isNotY, literalFirst, chained, switched]) console.log(check.name, values.map(value => check(value)).join(" "));

const level: number | bigint = Date.now() > 0 ? 3 : 3n;
console.log((level as any) === "r", (level as any) !== "r", "r" === (level as any));

const segments: any[] = [{ a: 1 }, undefined, { a: 2 }];
console.log(segments.some(() => segments.some((segment, at) => segment === "x" && segments[at + 1] === "y")));

async function waits(value: any): Promise<string> {
  try {
    await Promise.reject(new Error("first")).catch(() => undefined);
    if (value === "r") return "never";
    return "done";
  } catch {
    return "caught";
  } finally {
    await undefined;
  }
}
waits(level).then(console.log);
