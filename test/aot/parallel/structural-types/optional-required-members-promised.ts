// Optional and required members promised by a merged interface.
function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

interface Form {
  need: number;
  maybe?: number;
  needText: string;
  maybeText?: string;
}
class Form {
  id: number = 1;
  both(): number {
    return this.need + (this.maybe ?? 0);
  }
}

function needOf(form: Form): number {
  return form.need;
}

function maybeOf(form: Form): number | undefined {
  return form.maybe;
}

const form = new Form();
show("the required one", () => form.need);
show("the optional one", () => form.maybe);
show("are they the same", () => form.need === form.maybe);
show("the required one or one", () => form.need ?? 1);
show("the optional one or one", () => form.maybe ?? 1);
show("the required text", () => form.needText);
show("the optional text", () => form.maybeText);
show("the length of the required text", () => form.needText.length);
show("the length of the optional text", () => form.maybeText?.length);
show("in a method", () => form.both());
show("through functions", () => [needOf(form), maybeOf(form)]);
show("in", () => ["need" in form, "maybe" in form]);
show("keys", () => Object.keys(form));
show("JSON", () => JSON.stringify(form));

form.maybe = undefined;
form.maybeText = undefined;
show("undefined stored to the optional ones: in", () => ["need" in form, "maybe" in form, "maybeText" in form]);
show("undefined stored to the optional ones: keys", () => Object.keys(form));
show("undefined stored to the optional ones: JSON", () => JSON.stringify(form));
show("undefined stored to the optional ones: spread", () => Object.keys({ ...form }));

form.need = 2;
form.maybe = 3;
show("numbers stored to both", () => [form.need, form.maybe, form.both(), Object.keys(form)]);
delete form.maybe;
show("the optional one deleted", () => [form.need, form.maybe, form.both(), Object.keys(form)]);

const strict: Required<Form> = Object.assign(new Form(), { need: 1, maybe: 2, needText: "a", maybeText: "b" });
show("all four given", () => [strict.need + strict.maybe, strict.needText + strict.maybeText, Object.keys(strict)]);
const loose: Form = strict;
delete loose.maybe;
delete loose.maybeText;
show("two deleted through the class type", () => [strict.maybe, strict.need + strict.maybe, strict.maybeText, Object.keys(strict)]);
show("the length of the deleted text", () => strict.maybeText.length);
