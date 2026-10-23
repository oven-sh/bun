import type { FoundReference } from "./definitions.ts";
import { passedOver, type PassedOver } from "./shapes.ts";
import { originOf, type Occurrence, type Table, type Tree } from "./table.ts";

function fenced(text: string): string {
  return "```js\n" + text + "\n```";
}

function describeReference(reference: FoundReference): string {
  if (reference.kind === "itself") return `\`${reference.name}\`: the variable it is the value of`;
  if (reference.kind === "global") return `\`${reference.name}\` = \`${reference.path.join(".")}\``;
  if (reference.kind === "operand") return `\`${reference.name}\`: a variable of the file that the loop works on`;
  if (reference.kind === "definition")
    return `\`${reference.name}\`: the helper published as \`${reference.publishedName}\``;
  return `\`${reference.name}\`: ${reference.why}`;
}

function shortestPieceOnlyIn(where: string, others: readonly string[]): string {
  const words = where.split(" ");
  for (let length = 1; length < words.length; length++) {
    for (let start = 0; start + length <= words.length; start++) {
      const piece = words.slice(start, start + length).join(" ");
      if (others.every(other => !other.includes(piece))) return piece;
    }
  }
  return where;
}

function suggestedLine(tree: Tree, all: readonly Tree[]): string {
  const first = tree.occurrences[0];
  const isSamePlace = (occurrence: Occurrence) =>
    occurrence.tool === first.tool &&
    occurrence.version === first.version &&
    occurrence.publishedName === first.publishedName &&
    occurrence.part === first.part;
  const rivals = all.filter(other => other !== tree).flatMap(other => other.occurrences.filter(isSamePlace));
  const otherPlaces = rivals.map(rival => rival.where);
  const part = first.part === 1 ? "" : ` part: ${first.part},`;
  const where = rivals.length === 0 ? "" : ` where: ${JSON.stringify(shortestPieceOnlyIn(first.where, otherPlaces))},`;
  return `{ helper: "", shape: "", firstPublishedIn: "${first.tool}@${first.version}", publishedName: "${first.publishedName}",${part}${where} behavior: "" },`;
}

function namesOf(tree: Tree): string[] {
  return [...new Set(tree.occurrences.map(occurrence => occurrence.publishedName))];
}

function reasonToPassOver(tree: Tree): PassedOver | undefined {
  const reasons = tree.occurrences.map(occurrence =>
    passedOver.find(
      reason => reason.tool === occurrence.tool && reason.publishedNames.includes(occurrence.publishedName),
    ),
  );
  return reasons.includes(undefined) ? undefined : reasons[0];
}

function byFirstName(trees: readonly Tree[]): [string, Tree[]][] {
  const byName = new Map<string, Tree[]>();
  for (const tree of trees) {
    const name = tree.occurrences[0].publishedName;
    byName.set(name, [...(byName.get(name) ?? []), tree]);
  }
  return [...byName].sort(([a], [b]) => (a < b ? -1 : 1));
}

export function writeUnnamedShapes(table: Table): string {
  const all = [...table.unnamed, ...table.entries.map(entry => entry.tree)];
  const reasonOf = new Map<Tree, PassedOver | undefined>(table.unnamed.map(tree => [tree, reasonToPassOver(tree)]));
  const waiting = table.unnamed.filter(tree => reasonOf.get(tree) === undefined);
  const waitingByName = byFirstName(waiting);
  const lines = [
    "# Trees that no line of shapes.ts names",
    "",
    `${waiting.length} trees under ${waitingByName.length} published names wait for a name. ${table.unnamed.length - waiting.length} more are passed over on purpose. None of them is in the table.`,
    "",
  ];
  if (table.complaints.length > 0)
    lines.push("## Complaints about shapes.ts", "", ...table.complaints.map(line => `- ${line}`), "");
  for (const [name, trees] of waitingByName) {
    lines.push(`## ${name}`, "");
    for (const tree of trees) {
      const first = tree.occurrences[0];
      lines.push(`### ${originOf(tree, table.versionsRead)}`, "");
      lines.push(`- part ${first.part} of ${first.partCount}; first seen in: ${first.where}`);
      if (namesOf(tree).length > 1) lines.push(`- published as: ${namesOf(tree).join(", ")}`);
      if (tree.unsupported !== undefined) lines.push(`- has ${tree.unsupported}, which the comparison does not read`);
      for (const reference of tree.references) lines.push(`- ${describeReference(reference)}`);
      lines.push(`- \`${suggestedLine(tree, all)}\``, "", fenced(tree.text), "");
    }
  }
  for (const reason of passedOver) {
    const trees = table.unnamed.filter(tree => reasonOf.get(tree) === reason);
    if (trees.length === 0) continue;
    lines.push(`## Passed over: ${reason.what} of ${reason.tool}`, "");
    for (const [name, sameName] of byFirstName(trees)) {
      lines.push(`- \`${name}\`: ${sameName.map(tree => originOf(tree, table.versionsRead)).join(" | ")}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function writeShapes(table: Table): string {
  const lines = ["# The known helpers, by meaning and by tree", ""];
  const bytes = table.entries.reduce((sum, entry) => sum + entry.tree.text.length, 0);
  lines.push(`${table.entries.length} trees, ${bytes} bytes of text.`, "");
  const helpers = [...new Set(table.entries.map(entry => entry.line.helper))];
  for (const helper of helpers) {
    lines.push(`## ${helper}`, "");
    for (const entry of table.entries.filter(entry => entry.line.helper === helper)) {
      const first = entry.tree.occurrences[0];
      const last = entry.tree.occurrences[entry.tree.occurrences.length - 1];
      lines.push(`### ${entry.line.shape}`, "");
      lines.push(entry.line.behavior, "");
      lines.push(
        `- published as: ${namesOf(entry.tree).join(", ")}${first.partCount > 1 ? ` (function ${first.part} of ${first.partCount} in the definition)` : ""}`,
      );
      lines.push(`- in: ${entry.origin}`);
      lines.push(
        `- first: ${first.tool}@${first.version} (${first.publishedAt.slice(0, 10)}); last: ${last.tool}@${last.version} (${last.publishedAt.slice(0, 10)})`,
      );
      for (const reference of entry.tree.references) lines.push(`- ${describeReference(reference)}`);
      lines.push("", fenced(entry.tree.text), "");
    }
  }
  return lines.join("\n");
}
