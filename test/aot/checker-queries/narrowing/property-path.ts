// A test of a property path narrows the reads of that path. The object and the member keep their declared types.
declare const p: { value: string | number };
if (typeof p.value === "string") {
  p.value;
} else {
  p.value;
}
