// `optional` and `readonly` are flags, and `?` adds no `undefined` to the written type.
interface O { a?: number; readonly b: string; c: number | undefined }
let o: O;
export {};
