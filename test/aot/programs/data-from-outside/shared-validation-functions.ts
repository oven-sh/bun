// Call sites of JSON.parse<T>() with the same type share the functions that are emitted for the type.
// IR+ JSONStartsWith v\d+ text="\\x22height\\x22:"
// IR- JSONStartsWith v\d+ text="\\x22height\\x22:"[\s\S]*JSONStartsWith v\d+ text="\\x22height\\x22:"
interface Size { width: number; height: number }
interface Box { size: Size; label: string }

function first(text: string): number {
  return JSON.parse<Box>(text).size.height;
}
function second(text: string): number {
  return JSON.parse<Box>(text).size.width;
}
function third(text: string): string {
  return JSON.parse<Box>(text).label;
}
function describe(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return (error as Error).constructor.name + ": " + (error as Error).message;
  }
}
for (const text of ['{"size":{"width":2,"height":3},"label":"box"}', '{"label":"box","size":{"height":3,"width":2}}']) console.log(first(text), second(text), third(text));
for (const bad of ['{"size":{"width":2},"label":"box"}', '{"size":{"width":2,"height":"3"},"label":1}', "[", "null"]) {
  console.log(describe(() => first(bad)), "|", describe(() => second(bad)), "|", describe(() => third(bad)));
}
