import { ClassDefinition, define } from "../../codegen/class-definitions.ts";

const types = ["PostgresSQL", "MySQL"];
const rustPaths = {
  PostgresSQLConnection: "bun_sql_jsc::postgres::PostgresSQLConnection",
  PostgresSQLQuery: "bun_sql_jsc::postgres::PostgresSQLQuery",
  MySQLQuery: "bun_sql_jsc::mysql::js_my_sql_query::JSMySQLQuery",
};
const classes: ClassDefinition[] = [
  define({
    name: "PostgresSQLConnection",
    rustPath: rustPaths.PostgresSQLConnection,
    noConstructor: true,
    refCounted: true,
    configurable: false,
    hasPendingActivity: true,
    JSType: "0b11101110",
    proto: {
      close: {
        fn: "doClose",
      },
      flush: {
        fn: "doFlush",
      },
      hold: {
        fn: "doHold",
      },
      unhold: {
        fn: "doUnhold",
      },
      inTransaction: {
        getter: "getInTransaction",
      },
      ref: {
        fn: "doRef",
      },
      sasl: {
        getter: "getSasl",
      },
      onnotification: {
        getter: "getOnNotification",
        setter: "setOnNotification",
        this: true,
      },
    },
    values: ["onconnect", "onclose", "onretire", "checkServerIdentity", "columnTransform", "onnotification"],
  }),
];
for (const type of types) {
  classes.push(
    define({
      name: `${type}Query`,
      rustPath: rustPaths[`${type}Query`],
      noConstructor: true,
      refCounted: true,
      configurable: false,
      JSType: "0b11101110",
      proto: {
        run: {
          fn: "doRun",
          length: 2,
        },
        cancel: {
          fn: "doCancel",
          length: 0,
        },
        setMode: {
          fn: "setModeFromJS",
          length: 1,
        },
        setPendingValue: {
          fn: "setPendingValueFromJS",
          length: 1,
        },
        describeResult: {
          fn: "describeResult",
          length: 1,
        },
        ...(type === "PostgresSQL"
          ? {
              setCopy: {
                fn: "setCopy",
                length: 2,
              },
              copyWrite: {
                fn: "copyWrite",
                length: 1,
              },
              copyDone: {
                fn: "copyDone",
                length: 0,
              },
              copyFail: {
                fn: "copyFail",
                length: 1,
              },
              copyResume: {
                fn: "copyResume",
                length: 0,
              },
            }
          : {}),
      },
      values:
        type === "PostgresSQL" ? ["pendingValue", "target", "binding", "copy"] : ["pendingValue", "target", "binding"],
      estimatedSize: true,
    }),
  );
}

export default classes;
