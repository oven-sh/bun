// Optional fields, defaults by ?? and narrowing by in
interface Options { size?: number; name?: string; nested?: { deep?: number } }
function resolve(options: Options): string {
  const { size = 10, name = `n${size}` } = options;
  const deep = options.nested?.deep ?? size / 2;
  const has = "nested" in options ? "nested" : "flat";
  const merged: Required<Options> = { size, name, nested: { deep }, ...(options.size ? { size: options.size * 2 } : {}) };
  return `${merged.size} ${merged.name} ${merged.nested.deep} ${has}`;
}
console.log(resolve({ size: 4 }));
console.log(resolve({ size: 20, name: "x", nested: {} }));
console.log(resolve({ size: 6, nested: { deep: 0 } }));
