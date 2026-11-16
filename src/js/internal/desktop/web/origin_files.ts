// For the main realm: what the Cache API stores.
type Asked = { url: string; headers: string[][] };
type Options = { ignoreSearch?: boolean; ignoreVary?: boolean };

const { find } = require("internal/desktop/electron/loader");
const { split } = require("internal/desktop/web/mime");

function caches(sql: any, origin: string) {
  const idOf = (name: string): number | undefined =>
    sql.query("SELECT id FROM caches WHERE origin = ? AND name = ?").get(origin, JSON.stringify(name))?.id;

  function matching(cache: number, asked: Asked | undefined, { ignoreSearch, ignoreVary }: Options = {}) {
    const rows: any[] = sql
      .query("SELECT rowid, url, about FROM cache_entries WHERE cache = ? ORDER BY rowid")
      .all(cache);
    const compared = (url: string) => url.split(ignoreSearch ? /[?#]/ : "#")[0];
    return rows
      .filter(row => !asked || compared(row.url) === compared(asked.url))
      .map(row => ({ rowid: row.rowid, ...JSON.parse(row.about) }))
      .filter(({ request, response }) => {
        if (!asked || ignoreVary) return true;
        const names: string[] = split(find(response.headers, "vary")?.toLowerCase() ?? "");
        return names.every(name => name !== "*" && find(asked.headers, name) === find(request.headers, name));
      });
  }
  const remove = (entries: any[]) => {
    for (const { rowid } of entries) sql.query("DELETE FROM cache_entries WHERE rowid = ?").run(rowid);
    return entries.length > 0;
  };

  return {
    idOf,
    names: () =>
      sql
        .query("SELECT name FROM caches WHERE origin = ? AND name IS NOT NULL ORDER BY id")
        .values(origin)
        .map(row => JSON.parse(row[0])),
    open: (name: string) =>
      idOf(name) ??
      sql.query("INSERT INTO caches (origin, name) VALUES (?, ?) RETURNING id").get(origin, JSON.stringify(name)).id,
    /** Whoever has it open can go on using it. */
    discard(name: string) {
      sql.query("DELETE FROM cache_entries WHERE cache IN (SELECT id FROM caches WHERE name IS NULL)").run();
      return sql.query("UPDATE caches SET name = NULL WHERE id = ?").run(idOf(name) ?? null).changes > 0;
    },
    requests: (cache: number, asked?: Asked, options?: Options) =>
      matching(cache, asked, options).map(entry => entry.request),
    responses: (cache: number, asked?: Asked, options?: Options) =>
      matching(cache, asked, options).map(({ rowid, response }) => ({
        ...response,
        body: sql.query("SELECT body FROM cache_entries WHERE rowid = ?").get(rowid).body,
      })),
    remove: (cache: number, asked: Asked, options: Options) => remove(matching(cache, asked, options)),
    put: sql.transaction((cache: number, entries: any[]) => {
      let first = Infinity;
      for (const { request, response, body } of entries) {
        const replaced = matching(cache, request);
        if (replaced.some(entry => entry.rowid >= first))
          throw new DOMException("Duplicate requests.", "InvalidStateError");
        const insert = sql.query("INSERT INTO cache_entries VALUES (?, ?, ?, ?) RETURNING rowid");
        first = Math.min(first, insert.get(cache, request.url, JSON.stringify({ request, response }), body).rowid);
        remove(replaced);
      }
    }),
  };
}

export default { caches };
