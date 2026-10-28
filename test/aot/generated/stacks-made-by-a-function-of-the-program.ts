// The program stores a function under Error.prepareStackTrace, makes an error, gives it a property of its own and reads its stack. The function answers something else than a text, or changes the error it is handed.
// The old value is stored back or not, the error is made at once or behind six calls found one after the other, and it is an Error or a TypeError.
export const makers: Record<string, string> = {
  "answers an object": `(error, sites) => ({ tag: "made", count: typeof sites.length })`,
  "answers the call sites": `(error, sites) => sites`,
  "answers a number": `(error, sites) => 42`,
  "changes the error": `(error, sites) => { error.tag = "changed"; error.message = { tag: "object" }; return "text"; }`,
};

export interface Combination {
  maker: string;
  isStoredBack: boolean;
  isLate: boolean;
  errorClass: "Error" | "TypeError";
}

export const combinations: Combination[] = Object.keys(makers).flatMap(maker =>
  [true, false].flatMap(isStoredBack => [true, false].flatMap(isLate => (["Error", "TypeError"] as const).map(errorClass => ({ maker, isStoredBack, isLate, errorClass })))),
);

export const nameOf = ({ maker, isStoredBack, isLate, errorClass }: Combination) => `${maker}, ${isStoredBack ? "the old value is stored back" : "it stays"}, ${isLate ? "late" : "at once"}, ${errorClass}`;

export function textOf({ maker, isStoredBack, isLate, errorClass }: Combination) {
  const make = `() => { const e = new ${errorClass}("m"); e.tag = 1; const s = e.stack; return [s, e]; }`;
  return `function late(read) { const h0 = { next: read }; const h1 = { next: () => h0.next() }; const h2 = { next: () => h1.next() }; const h3 = { next: () => h2.next() }; const h4 = { next: () => h3.next() }; const h5 = { next: () => h4.next() }; return h5.next(); }
function show(s) { return typeof s + ":" + Array.isArray(s) + ":" + (typeof s === "object" && s !== null ? Object.keys(s).join(",") + ":" + String(s.tag) : typeof s === "string" ? "text" : String(s)); }
function withMaker(run) { const before = Error.prepareStackTrace; Error.prepareStackTrace = ${makers[maker]}; try { return run(); } finally { ${isStoredBack ? "Error.prepareStackTrace = before;" : ""} } }
const [s, e] = withMaker(() => ${isLate ? `late(${make})` : `(${make})()`});
console.log(show(s));
console.log(typeof e.tag, String(e.tag), typeof e.message, typeof e.message === "string" ? e.message.length : Object.keys(e.message).join(","));
`;
}
