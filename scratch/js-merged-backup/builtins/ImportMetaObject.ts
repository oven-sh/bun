type ImportMetaObject = Partial<ImportMeta>;

$getter;
export function main(this: ImportMetaObject) {
  return this.path === Bun.main && Bun.isMainThread;
}
