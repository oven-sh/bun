export function where(): string {
  return [import.meta.path, import.meta.dir, import.meta.file, import.meta.url].join(" | ");
}
