// Parsed by type long strings and many elements.
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  const parent = Object.getPrototypeOf(value);
  const mark = parent === Object.prototype ? "" : parent === null ? "without a prototype " : "with another prototype ";
  return mark + "{" + Object.entries(value).map(([key, held]) => JSON.stringify(key) + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

interface Page {
  text: string;
  items: { id: number; tag: string }[];
}

function idSum(page: Page): number {
  let sum = 0;
  for (const item of page.items) sum += item.id;
  return sum;
}
function tagLength(page: Page): number {
  let length = 0;
  for (const item of page.items) length += item.tag.length;
  return length;
}

attempt("a string of a million letters", () => {
  const page = JSON.parse('{"text":"' + "ab".repeat(500_000) + '","items":[]}') as Page;
  return [page.text.length, page.text.slice(-3), page.text.charCodeAt(999_999), page.items];
});
attempt("a string of a hundred thousand escapes", () => {
  const page = JSON.parse('{"text":"' + "\\n\\u00e9".repeat(50_000) + '","items":[]}') as Page;
  return [page.text.length, page.text.charCodeAt(99_999), page.text.charCodeAt(99_998)];
});
attempt("fifty thousand items", () => {
  const parts: string[] = [];
  for (let i = 0; i < 50_000; i++) parts.push('{"id":' + i + ',"tag":"t' + (i % 7) + '"}');
  const page = JSON.parse('{"text":"","items":[' + parts.join(",") + "]}") as Page;
  return [page.items.length, idSum(page), tagLength(page), page.items[49_999], Object.keys(page.items[25_000])];
});
attempt("items whose keys change places", () => {
  const parts: string[] = [];
  for (let i = 0; i < 5_000; i++) parts.push(i % 3 === 0 ? '{"id":' + i + ',"tag":"a"}' : i % 3 === 1 ? '{"tag":"bb","id":' + i + "}" : '{"more":0,"tag":"ccc","id":' + (i + 0.5) + "}");
  const page = JSON.parse('{"items":[' + parts.join(",") + '],"text":"t"}') as Page;
  return [page.items.length, idSum(page), tagLength(page), page.items[0], page.items[1], page.items[2], Object.keys(page)];
});
attempt("a key of ten thousand letters", () => {
  const key = "k".repeat(10_000);
  const table = JSON.parse('{"' + key + '":1,"' + key + 'x":2}') as Record<string, number>;
  return [Object.keys(table).map(name => name.length), table[key], table[key + "x"]];
});
attempt("much white space", () => {
  const space = " \n\t\r".repeat(25_000);
  const page = JSON.parse(space + "{" + space + '"text"' + space + ":" + space + '"t"' + space + "," + space + '"items"' + space + ":" + space + "[" + space + "]" + space + "}" + space) as Page;
  return page;
});
