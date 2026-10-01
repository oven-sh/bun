// Emits the Kind enum, its markers and the guards of the kind aliases.
import { api } from "/workspace/ref/typescript-go/_scripts/schema.ts";
import { GENERATED, snake, upperSnake } from "./names.ts";

export function generateKind(): { text: string; count: number } {
  const out: string[] = [GENERATED("gen/gen-kind.ts", "_scripts/ast.json"), ""];
  const names = api.kindElements().filter(e => e.name).map(e => e.name!);
  names.push("Count");
  out.push("#[repr(u16)]", "#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug, Default)]", "pub enum Kind {");
  names.forEach((n, i) => out.push(i === 0 ? `    #[default]\n    ${n},` : `    ${n},`));
  out.push("}", "");
  out.push(`pub const KIND_COUNT: usize = ${names.length - 1};`, "");
  out.push("#[rustfmt::skip]", `static KINDS: [Kind; ${names.length}] = [`);
  for (const n of names) out.push(`    Kind::${n},`);
  out.push("];", "");
  out.push("#[rustfmt::skip]", `static KIND_NAMES: [&str; ${names.length}] = [`);
  for (const n of names) out.push(`    "${n}",`);
  out.push("];", "");
  const sorted = names.map((n, i) => [n, i] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  out.push("#[rustfmt::skip]", `static KINDS_BY_NAME: [(&str, Kind); ${names.length}] = [`);
  for (const [n] of sorted) out.push(`    ("${n}", Kind::${n}),`);
  out.push("];", "");
  out.push("impl Kind {");
  for (const marker of api.kindMarkers()) {
    out.push(`    pub const ${upperSnake(marker.name)}: Kind = Kind::${api.resolveKindMarkerValue(marker.name)};`);
  }
  out.push(
    "    // A number that is no kind is Unknown.",
    "    pub fn from_u32(value: u32) -> Kind {",
    "        KINDS.get(value as usize).copied().unwrap_or(Kind::Unknown)",
    "    }",
    "    // Kind.String() of upstream without the Kind prefix.",
    "    pub fn name(self) -> &'static str {",
    '        KIND_NAMES.get(self as usize).copied().unwrap_or("Unknown")',
    "    }",
    "    pub fn from_name(name: &[u8]) -> Option<Kind> {",
    "        let at = KINDS_BY_NAME.binary_search_by(|entry| entry.0.as_bytes().cmp(name)).ok()?;",
    "        KINDS_BY_NAME.get(at).map(|entry| entry.1)",
    "    }",
    "}",
    "",
  );
  // JSDocSyntaxKind would give is_jsdoc_kind, which upstream hand-writes in utilities.go with another meaning.
  const skip = new Set(["IsJSDocKind"]);
  for (const guard of api.kindGuards()) {
    const goName = guard.guardName.charAt(0).toUpperCase() + guard.guardName.slice(1);
    if (skip.has(goName)) continue;
    out.push(`pub fn ${snake(goName)}(kind: Kind) -> bool {`);
    if (guard.type === "range") {
      out.push(`    kind >= Kind::${api.resolveKindMarkerValue(guard.first)} && kind <= Kind::${api.resolveKindMarkerValue(guard.last)}`);
    } else {
      const members = api.expandKindAliasMembers(guard.aliasName).map(m => `Kind::${m.name}`);
      out.push(`    matches!(kind, ${members.join(" | ")})`);
    }
    out.push("}", "");
  }
  return { text: out.join("\n"), count: names.length - 1 };
}
