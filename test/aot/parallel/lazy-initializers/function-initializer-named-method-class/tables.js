export function column(name, empty) {
  return (load, save) => ({
    read: () => load()[name] ?? empty,
    write: next => save(row => ({ ...row, [name]: next(row[name] ?? empty) })),
  });
}
