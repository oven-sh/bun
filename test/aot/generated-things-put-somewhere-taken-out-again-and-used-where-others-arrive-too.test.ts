// Fixed seeds of fuzz/things-put-somewhere-taken-out-again-and-used-where-others-arrive-too.ts: one thing is put somewhere (the prototype of a function, the cause of an error, a promise, a map, a descriptor, a proxy,
// the reason of a signal ..), taken out again, in the same file or in another one, and used at a place where another thing of its kind arrives too. Every place meets every thing that it takes.
// TypeScript accepts every program, so every build succeeds, and the executable prints what plain Bun prints and ends as it ends. Every third program is built with its types erased.
import { Random } from "./fuzz/random";
import {
  corners,
  generate,
  laterThings,
  thingsOf,
} from "./fuzz/things-put-somewhere-taken-out-again-and-used-where-others-arrive-too";
import { generated } from "./generated/run-generated";

/** The thing loads modules, makes functions out of text or evaluates text, and the executable refuses the call behind the place. */
const losesWhatLoads = [
  1494, 1544, 1546, 1549, 1562, 1575, 1581, 1626, 1628, 1637, 1639, 1647, 1659, 1692, 1693, 1694, 1707, 1716, 1720,
  1721, 1722, 1725, 1726, 1728, 1740, 1773, 1782, 1784, 1792, 1834, 1837, 1839, 1861, 1865, 1866, 1867, 1871, 1873,
  1916, 1918, 1923, 1925, 1927, 1929, 1937, 1982, 1983, 1984, 1988, 1995, 1997, 2006, 2010, 2011, 2012, 2014, 2015,
  2016, 2036, 2072, 2074, 2082, 2124, 2128, 2129, 2151, 2155, 2156, 2157, 2161, 2163,
];

const onceWrong = [1578, 1723];

generated(
  "things put somewhere, taken out again and used where others arrive too",
  Array.from({ length: corners.length * (11 + laterThings.length) }, (_, index) => {
    const corner = corners[index % corners.length];
    const row = Math.floor(index / corners.length);
    const takes = thingsOf(corner);
    // A place that takes functions takes the later things too; another place goes through its own things once more.
    const thing =
      row >= 11 && takes.includes("a function that loads modules") ? laterThings[row - 11] : takes[row % takes.length];
    const isErased = (index + row) % 3 === 2;
    return {
      name: `seed ${index + 1}, ${corner}, ${thing}${isErased ? ", types erased" : ""}.`,
      // Every run takes one place in eleven, with another thing in each row; AOT_GENERATED=all takes all.
      isAlwaysRun: (index + row) % 11 === 0,
      isOnlyCompiled: true as const,
      // Each program is built alone and as it is written: what it may load is its own.
      keepsItsText: true as const,
      exitsAsPlainBunDoes: true as const,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      // No executable lists its own modules there, with or without --aot.
      ...(corner === "the cache of require" && { referenceIsCompiled: true as const }),
      ...(onceWrong.includes(index + 1) && { wasOnceWrong: true }),
      ...(losesWhatLoads.includes(index + 1) && {
        linesDepartToday: "what loads modules or runs text is refused once it has been there",
      }),
      make: () => generate(new Random(index + 1), corner, thing),
    };
  }),
);
