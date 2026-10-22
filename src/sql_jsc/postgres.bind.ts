import * as b from "../codegen/bindgen-lib.ts";

const js = { returns: b.any, capability: "js", throws: true } as const;

export const binding = b.namespace({
  init: {
    args: { onResolveQuery: b.any, onRejectQuery: b.any, arrayLiteral: b.any },
    capability: "heap",
    length: 0,
    rustPath: "crate::postgres::PostgresSQLContext::init",
  },
  createQuery: {
    ...js,
    args: { query: b.any, values: b.any, pendingValue: b.any, bigint: b.any, simple: b.any },
    rustPath: "crate::postgres::PostgresSQLQuery::create_query",
  },
  createConnection: {
    ...js,
    args: { args: b.any.variadic },
    length: 2,
    rustPath: "crate::postgres::postgres_sql_connection::create_connection",
  },
});
