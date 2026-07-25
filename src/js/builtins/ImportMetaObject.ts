type ImportMetaObject = Partial<ImportMeta>;

$getter;
export function main(this: ImportMetaObject) {
  // Node (v24+) defines import.meta.main as "is this module the entry point
  // of the current thread" — true for a worker's entry module too.
  return this.path === Bun.main;
}
