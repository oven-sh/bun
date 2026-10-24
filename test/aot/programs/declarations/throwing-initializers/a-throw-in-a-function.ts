function fail(): { a: number } { throw new RangeError("made"); }
export const made = fail();
