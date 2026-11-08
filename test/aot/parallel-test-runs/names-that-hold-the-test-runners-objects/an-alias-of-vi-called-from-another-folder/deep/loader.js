export function load(ask) {
  const got = ask();
  return got.where;
}
export async function loadLater(ask) {
  const got = await ask();
  return (got.default ?? got).where;
}
