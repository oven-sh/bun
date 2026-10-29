// Applies arithmetic to literals that are no numbers, changes the sign of the result and prints its bytes.
const bytes = new Uint8Array(8),
  number = new Float64Array(bytes.buffer);
const hex = (value: number) => {
  number[0] = value;
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0"))
    .reverse()
    .join("")
    .slice(0, 4);
};
console.log(
  "texts",
  hex(-(("a" as any) * 1)),
  hex(-(("a" as any) - 1)),
  hex(-(1 / ("b" as any))),
  hex(-(("x" as any) % 2)),
  hex(-(("x" as any) ** 2)),
  hex(-(2 ** ("x" as any))),
);
console.log(
  "undefined",
  hex(-((void 0 as any) + 1)),
  hex(-((undefined as any) + 1)),
  hex(-((undefined as any) * 2)),
  hex(-(1 - (undefined as any))),
  hex(-((undefined as any) + (undefined as any))),
  hex(-((undefined as any) ** 1)),
);
console.log(
  "not negated",
  hex(("a" as any) * 1),
  hex((void 0 as any) + 1),
  hex((undefined as any) * -1),
  hex(-1 * (undefined as any)),
  hex(("a" as any) / -1),
);
console.log(
  "numbers",
  hex(-(0 / 0)),
  hex(-(5 % 0)),
  hex(-((1 / 0) % 2)),
  hex(-(2 ** (0 / 0))),
  hex(-((-8) ** (1 / 3))),
  hex(-(1 / 0 - 1 / 0)),
  hex(-((1 / 0) * 0)),
);
console.log(
  "no NaN",
  hex(-((true as any) + 1)),
  hex(-((null as any) + 1)),
  hex(-(("2" as any) * 3)),
  hex(-(("" as any) * 1)),
);
console.log(
  "decided",
  ("a" as any) * 1 ? "yes" : "no",
  (void 0 as any) + 1 ? "yes" : "no",
  !((undefined as any) * 2),
  typeof ((undefined as any) + 1),
  `${("a" as any) * 1}`,
);
