class Failing { constructor() { throw new RangeError("made"); } }
export const made = new Failing();
