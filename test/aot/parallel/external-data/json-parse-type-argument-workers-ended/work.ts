type Row = { id: number; name: string; tags: string[]; inner: { a: number; b?: string } };

export function rows(count: number): string {
  const items: string[] = [];
  for (let at = 0; at < count; at++) items.push('{"id":' + at + ',"name":"name ' + at + ' that is longer than a short string would be","u' + (at % 700) + '":[' + at + '],"tags":["t","' + at + '"],"inner":{"a":' + at + (at % 2 ? ',"b":"b"' : "") + "}}");
  return "[" + items.join(",") + "]";
}

export function work(text: string): number {
  const parsed = JSON.parse(text) as Row[];
  const written = JSON.stringify(parsed);
  return written.length === text.length ? parsed.length : -1;
}
