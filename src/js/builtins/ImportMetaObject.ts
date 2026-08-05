type ImportMetaObject = Partial<ImportMeta>;

$getter;
export function main(this: ImportMetaObject) {
  const m = Bun.main;
  return this.path === m || this.url === m;
}
