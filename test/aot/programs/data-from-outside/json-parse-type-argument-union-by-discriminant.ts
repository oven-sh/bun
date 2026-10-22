// For a union of object types whose members differ in a literal property, JSON.parse<T>() reads that property once and validates the one member that can accept the value.
// IR+ JSONFindMember v\d+ name="kind"
interface Size { width: number; height: number }
interface Circle { size: Size; kind: "circle"; radius: number }
interface Square { size: Size; kind: "square"; side: number }
interface Label { size: Size; kind: "label"; text: string; bold?: boolean }
type Shape = Circle | Square | Label;
type ShapeOrNothing = Shape | null | number[];
type ByNumber = { code: 1; one: string } | { code: 2; two: string } | { code: 3; three: boolean };
type ByBoolean = { ok: true; value: number } | { ok: false; reason: string };
type SameTag = { kind: "a"; x: number } | { kind: "a"; y: number };
type OptionalTag = { kind?: "a"; x: number } | { kind: "b"; x: string };
type WideTag = { kind: "a" | "b"; x: number } | { kind: "c"; x: string };
type WithDictionary = Circle | Record<string, unknown>;
function describe(run: () => unknown): string {
  try {
    return JSON.stringify(run());
  } catch (error) {
    const issues = (error as { issues?: { path: (string | number)[]; code: string; expected: string }[] }).issues;
    return issues ? issues.map(issue => issue.path.join(".") + " " + issue.code + " " + issue.expected).join("; ") : String(error);
  }
}
function parseShape(text: string): Shape {
  return JSON.parse<Shape>(text);
}
const size = { width: 1, height: 2 };
const values: unknown[] = [
  { size, kind: "circle", radius: 1 },
  { size, kind: "square", side: 2 },
  { kind: "label", text: "t", size, bold: true, more: 1 },
  { size, kind: "label", text: 5 },
  { size, kind: "triangle" },
  { size: { width: "1" }, kind: "square", side: 2 },
  { size },
  { kind: "circle" },
  null,
  [1, 2],
  ["1"],
  "circle",
  { code: 2, two: "t" },
  { code: "2", two: "t" },
  { code: 3, three: 1 },
  { ok: false, reason: "r" },
  { ok: true, value: 1 },
  { ok: 1, value: 1 },
  { kind: "a", y: 1 },
  { x: 1 },
  { kind: "b", x: "s" },
  { kind: "b", x: 1 },
  { kind: "c", x: "s" },
];
for (const value of values) {
  const text = JSON.stringify(value);
  console.log(
    [
      describe(() => parseShape(text)),
      describe(() => JSON.parse<ShapeOrNothing>(text)),
      describe(() => JSON.parse<ByNumber>(text)),
      describe(() => JSON.parse<ByBoolean>(text)),
      describe(() => JSON.parse<SameTag>(text)),
      describe(() => JSON.parse<OptionalTag>(text)),
      describe(() => JSON.parse<WideTag>(text)),
      describe(() => JSON.parse<WithDictionary>(text)),
      describe(() => JSON.parse<Shape[]>("[" + text + "," + text + "]")),
    ].join(" | "),
  );
}
