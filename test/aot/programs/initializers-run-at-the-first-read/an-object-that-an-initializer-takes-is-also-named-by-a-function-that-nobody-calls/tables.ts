export function column(name: string, empty: object) {
  return (load: () => any, save: (change: (row: any) => any) => void) => ({
    read: () => load()[name] ?? empty,
    write: (next: (cell: any) => any) => save(row => ({ ...row, [name]: next(row[name] ?? empty) })),
  });
}
