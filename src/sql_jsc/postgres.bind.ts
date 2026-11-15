import * as b from "../codegen/bindgen-lib.ts";
import { PostgresSQLConnection } from "./postgres/PostgresSQLConnection.bind.ts";
import { PostgresSQLQuery } from "./postgres/PostgresSQLQuery.bind.ts";

const js = { capability: "js", throws: true } as const;
const text = b.string.loose.utf8;
const milliseconds = b.f64.loose;

export const binding = b.namespace({
  init: {
    args: { onResolveQuery: b.callable, onRejectQuery: b.callable, arrayLiteral: b.callable },
    capability: "heap",
    length: 0,
    rustPath: "crate::postgres::PostgresSQLContext::init",
  },
  createQuery: {
    ...js,
    args: {
      query: b.string.allowStringObject.owned,
      values: b.jsArray,
      pendingValue: b.jsArray,
      bigint: b.bool,
      simple: b.bool,
    },
    expected: { values: "values must be an array" },
    returns: PostgresSQLQuery,
    rustPath: "crate::postgres::PostgresSQLQuery::create_query",
  },
  /** The arguments of `NativeCreateConnection` in `src/js/internal/sql/pool.ts`. The ones that are `b.any`, except `tls`, are for MySQL. */
  createConnection: {
    ...js,
    args: {
      hostname: text,
      port: b.f64,
      username: text,
      password: text,
      database: text,
      sslMode: b.u8.validateInteger(0, 4),
      tls: b.any,
      query: text,
      path: text,
      onConnected: b.callable,
      onDisconnected: b.callable,
      idleTimeout: milliseconds,
      connectionTimeout: milliseconds,
      maxLifetime: milliseconds,
      useUnnamedPreparedStatements: b.bool,
      allowPublicKeyRetrieval: b.any,
      onRetire: b.callable.optional,
      foundRows: b.any,
      channelBinding: b.u8.validateInteger(0, 2),
      columnTransform: b.callable.optional,
      scramPassword: text,
    },
    returns: PostgresSQLConnection,
    length: 2,
    rustPath: "crate::postgres::postgres_sql_connection::create_connection",
  },
});
