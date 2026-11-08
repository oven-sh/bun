// A type error in a `.ts` file stops the build.
// RUN: link
// DIAGNOSTIC: TS2322 type-error-stops-the-build.ts:5

export const count: number = "one";
