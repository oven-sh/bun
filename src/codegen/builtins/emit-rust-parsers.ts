import { emitSlice, formatBuiltinId } from "./emit-rust-ids.ts";
import type { TableModel } from "./model.ts";
import type { TypedResultForm } from "./vocabulary.ts";

const parsingForms: readonly TypedResultForm[] = ["ParsedText", "ParsedBody", "Rows"];

// The built-ins that make their answer out of text or bytes, and may make it with the layouts of the type it is written under.
export function emitRustParsers(model: TableModel): string {
  const parsers = model.builtins
    .filter(builtin => builtin.overloads.some(overload => parsingForms.includes(overload.result.typedResultForm)))
    .sort((left, right) => left.id - right.id);
  return emitSlice("static PARSERS: &[BuiltinId]", parsers.map(formatBuiltinId));
}
