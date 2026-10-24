type Reason = "RETENTION" | "GENERATION" | "ROTATION" | "SERVER";
const later: Array<() => void> = [];
function open(options: { forceMint: boolean; kind: string }): void {
  console.log("open", options.forceMint, options.kind);
}
function onReset(reason: Reason): void {
  switch (reason) {
    case "RETENTION":
    case "GENERATION":
    case "ROTATION":
      later.push(() => open({ forceMint: reason !== "RETENTION", kind: typeof reason }));
      return;
    default:
      later.push(() => open({ forceMint: false, kind: typeof reason }));
  }
}
const values: any[] = [
  "RETENTION",
  "ROTATION",
  "SERVER",
  "RETEN" + String(["TION"]),
  new String("RETENTION"),
  { toString: () => "RETENTION" },
  ["RETENTION"],
  () => "RETENTION",
  Symbol.for("RETENTION"),
  1,
  -0,
  NaN,
  1n,
  true,
  null,
  undefined,
];
for (const value of values) onReset(value);
for (const run of later) run();
