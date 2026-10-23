// `noImplicitAny` is asked of the file that holds the access.
export const pick = (from: { a: number }, key: string) => from[key];
