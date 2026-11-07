// Applies operators to constants that are declared behind a statement and prints the bytes of the results.
console.log("first");
const nothing = undefined;
const text = "x";
const zero = 0;
const minusZero = -0;
const infinity = Infinity;
const notANumber = NaN;
const minusEight = -8;
const third = 1 / 3;
const oneAndAHalf = 1.5;
const minusOne = -1;
const one = 1;
const none = null;
const nothingByDefault = undefined;
const all = { nothing: undefined, text: "x" };
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
  "minus",
  hex(-(nothing as any)),
  hex(-(text as any)),
  hex(-notANumber),
  hex(-(nothingByDefault as any)),
  hex(-(all.nothing as any)),
  hex(-(all["text"] as any)),
);
console.log("plus", hex(+(nothing as any)), hex(+(text as any)), hex(+notANumber));
console.log("twice", hex(-(-(nothing as any))), hex(-+(nothing as any)), hex(+-(nothing as any)), hex(-(-notANumber)));
console.log(
  "quotients",
  hex(zero / zero),
  hex(-(zero / zero)),
  hex(infinity / infinity),
  hex(minusZero / zero),
  hex(zero / minusZero),
);
console.log(
  "products",
  hex(infinity * zero),
  hex(zero * infinity),
  hex(-infinity * zero),
  hex((nothing as any) * minusOne),
  hex(minusOne * (nothing as any)),
);
console.log(
  "sums",
  hex(infinity - infinity),
  hex(-infinity + infinity),
  hex((nothing as any) + one),
  hex(one + (nothing as any)),
  hex((nothing as any) - zero),
  hex(zero - (nothing as any)),
);
console.log(
  "remainders",
  hex(zero % zero),
  hex(one % zero),
  hex(infinity % one),
  hex(minusOne % zero),
  hex((nothing as any) % one),
);
console.log(
  "powers",
  hex(minusEight ** third),
  hex(minusOne ** oneAndAHalf),
  hex(notANumber ** one),
  hex((nothing as any) ** one),
  hex(one ** infinity),
  hex(minusOne ** infinity),
  hex(one ** notANumber),
);
console.log(
  "of a NaN",
  hex(notANumber + one),
  hex(one - notANumber),
  hex(notANumber * minusOne),
  hex(notANumber / minusOne),
  hex(-notANumber + one),
  hex(-(notANumber + one)),
);
console.log(
  "mixed",
  hex(-(nothing as any) + one),
  hex(-((nothing as any) + one)),
  hex((zero / zero) * minusOne),
  hex(-(zero / zero) - one),
  hex(-(text as any) * 2),
);
console.log(
  "no NaN",
  hex(-zero),
  hex(-minusZero),
  hex(-(none as any)),
  hex(one / zero),
  hex(minusOne / zero),
  hex(-infinity),
  hex(zero * minusOne),
  hex(minusEight ** 2),
);
console.log(
  "decided",
  -(nothing as any) ? "yes" : "no",
  zero / zero ? "yes" : "no",
  !-(nothing as any),
  typeof -(nothing as any),
  -(nothing as any) === -(nothing as any),
  `${-(nothing as any)}`,
  String(zero / zero),
  (zero / zero) | 0,
  ~(nothing as any),
);
