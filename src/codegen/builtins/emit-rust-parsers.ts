import { emitSlice, formatBuiltinId } from "./emit-rust-ids.ts";
import type { TableModel } from "./model.ts";
import type { TypedResultForm } from "./vocabulary.ts";

const parsingForms: readonly TypedResultForm[] = ["ParsedText", "ParsedBody", "Rows"];

function emitBuiltinsWithForm(model: TableModel, declaration: string, forms: readonly TypedResultForm[]): string {
  const builtins = model.builtins
    .filter(builtin => builtin.overloads.some(overload => forms.includes(overload.result.typedResultForm)))
    .sort((left, right) => left.id - right.id);
  return emitSlice(declaration, builtins.map(formatBuiltinId));
}

// The built-ins that make their answer out of text or bytes, and may make it with the layouts of the type it is written under.
export function emitRustParsers(model: TableModel): string {
  return (
    emitBuiltinsWithForm(model, "static PARSERS: &[BuiltinId]", parsingForms) +
    emitBuiltinsWithForm(model, "static QUERY_FUNCTIONS: &[BuiltinId]", ["Rows"])
  );
}
