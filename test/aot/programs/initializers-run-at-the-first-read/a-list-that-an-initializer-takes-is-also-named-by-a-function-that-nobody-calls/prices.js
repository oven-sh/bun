export function column(name, empty) {
  return (load, save) => ({
    read: () => load()[name] ?? empty,
    write: next => save(row => ({ ...row, [name]: next(row[name] ?? empty) })),
  });
}
const nothing = [{ low: 1 }, { high: 2 }];
export const prices = column("prices", nothing);
export function neverCalled() {
  return nothing;
}
