// Call sites with the same type share the functions that are emitted for the type.
// IR= 1 validate String ",\\x22height\\x22:"
interface Size { width: number; height: number }
interface Box { size: Size; label: string }

function first(text: string): number {
  return Bun.parse<Box>(text).size.height;
}
function second(text: string): number {
  return Bun.parse<Box>(text).size.width;
}
function third(text: string): string {
  return Bun.parse<Box>(text).label;
}
function checked(value: unknown): number {
  return Bun.validate<Box>(value).size.height;
}
function checkedAgain(value: unknown): string {
  const result = Bun.safeValidate<Box>(value);
  return result.success ? result.data.label : result.issues.map(issue => issue.path.join(".") + " " + issue.code).join();
}
function describe(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return (error as Error).constructor.name + ": " + (error as Error).message;
  }
}
const text = '{"size":{"width":2,"height":3},"label":"box"}';
console.log(first(text), second(text), third(text), checked(JSON.parse(text)), checkedAgain(JSON.parse(text)));
for (const bad of ['{"size":{"width":2},"label":"box"}', '{"size":{"width":2,"height":"3"},"label":1}', "[", "null"]) {
  console.log(describe(() => first(bad)), "|", describe(() => second(bad)), "|", describe(() => third(bad)));
}
console.log(describe(() => checked({ size: { width: 1 } })), "|", checkedAgain({ size: { width: 1 } }), "|", checkedAgain(null));
const schema = Bun.schema<Box>()["~standard"];
console.log(JSON.stringify(schema.validate(JSON.parse(text))), JSON.stringify(schema.validate({ size: 1 })));
