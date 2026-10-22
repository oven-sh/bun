declare const aotOperationCount: (name: string) => number;
// Plain objects that untyped code built are read as members of a discriminated union, and as records with fields whose type is a union of string literals. A text among the literals passes however it was built: at run time, as a rope, out of a 16-bit text. Any other text, and a value that is no string, throws where typed code reads the field; undefined and null pass. The program also prints whether the slow type test of the runtime was entered for most of the objects.
type Inner = { n: number };
type Circle = { kind: "circle"; inner: Inner; radius: number };
type Square = { kind: "square"; inner: Inner; side: number };
type Figure = Circle | Square;
type Issue = { state: "open" | "closed" | ""; level?: "low" | "high" | null; inner: Inner; title: string };

function makeInner(n: number): Inner {
  return { n };
}
function makeFigure(i: number, inner: Inner): Figure {
  return i % 2 ? { kind: "circle", inner, radius: i } : { kind: "square", inner, side: i };
}
function makeIssue(inner: Inner): Issue {
  return { state: "open", level: "low", inner, title: "typed" };
}
function area(figure: Figure): number {
  return figure.inner.n + (figure.kind === "circle" ? figure.radius * 3 : figure.side * figure.side);
}
function describe(issue: Issue): string {
  return issue.state + "/" + issue.level + "/" + issue.inner.n + "/" + issue.title + "/" + (issue.state === "closed" ? "done" : "to do");
}
function growFigure(kind: unknown, inner: Inner, i: number): any {
  const figure: any = { kind };
  figure.inner = inner;
  if (kind === "circle") figure.radius = i;
  else figure.side = i;
  return figure;
}
function growIssue(state: unknown, level: unknown, inner: Inner): any {
  const issue: any = { state };
  issue.level = level;
  issue.inner = inner;
  issue.title = "grown";
  return issue;
}
function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (e) {
    return e instanceof Error ? e.name : String(e);
  }
}

const inner = makeInner(7);
console.log(area(makeFigure(1, inner)), area(makeFigure(2, inner)), describe(makeIssue(inner)));

const kept: any[] = [];
let sum = 0;
let text = "";
const letters = ["cir", "cle", "squ", "are", "clo", "sed", "op", "en"];
let before = aotOperationCount("operationAOTEnforceType");
for (let i = 0; i < 400; i++) {
  const figure = growFigure(i % 2 ? "circle" : "square", inner, i);
  kept.push(figure);
  sum += area(figure);
}
let slow = aotOperationCount("operationAOTEnforceType") - before;
console.log(sum, slow < 20 ? "without the runtime" : "through the runtime: " + slow);
before = aotOperationCount("operationAOTEnforceType");
for (let i = 0; i < 400; i++) {
  const issue = growIssue(i % 3 ? (i % 3 === 1 ? "open" : "closed") : "", i % 4 ? (i % 4 === 1 ? "low" : i % 4 === 2 ? "high" : null) : undefined, inner);
  kept.push(issue);
  text = describe(issue);
  sum += text.length;
}
slow = aotOperationCount("operationAOTEnforceType") - before;
console.log(sum, text, slow < 20 ? "without the runtime" : "through the runtime: " + slow);
console.log(JSON.stringify(kept[1]), JSON.stringify(kept[2]), Object.keys(kept[1]).join(), kept[1].kind, kept[2].kind);
console.log(JSON.stringify(kept[401]), JSON.stringify(kept[402]), JSON.stringify(kept[403]), JSON.stringify(kept[404]), Object.keys(kept[401]).join());

for (let i = 0; i < 8; i++) {
  const built = letters[(i % 2) * 2] + letters[(i % 2) * 2 + 1];
  const sliced = ("x" + built + "y").slice(1, -1);
  console.log(attempt(() => area(growFigure(built, inner, i))), attempt(() => area(growFigure(sliced, inner, i))));
  const state = letters[4 + (i % 2) * 2] + letters[5 + (i % 2) * 2];
  console.log(attempt(() => describe(growIssue(state, "high", inner))), attempt(() => describe(growIssue(("é" + state).slice(1), "low", inner))));
}
for (const odd of ["Circle", "circl", "circles", "circle\0", "", "triangle", "a text of more than seven", "é", 1, null, undefined, true, { toString: () => "circle" }, ["circle"]]) {
  console.log(attempt(() => area(growFigure(odd, inner, 2))), "|", attempt(() => describe(growIssue(odd, "low", inner))), "|", attempt(() => describe(growIssue("open", odd, inner))));
}
const changed = growFigure("circle", inner, 3);
console.log(area(changed), attempt(() => { changed.kind = "square"; return JSON.stringify(changed); }));
const reopened = growIssue("closed", "low", inner);
console.log(describe(reopened), attempt(() => { reopened.state = "open"; return describe(reopened); }), attempt(() => { reopened.state = "other"; return JSON.stringify(reopened); }));
