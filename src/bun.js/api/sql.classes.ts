import { ClassDefinition, define } from "../../codegen/class-definitions";

const types = ["PostgresSQL", "MySQL"];
const classes: ClassDefinition[] = [];
for (const type of types) {
  const isPostgres = type === "PostgresSQL";
  const proto: Record<string, any> = {
    close: {
      fn: "doClose",
    },
    connected: {
      getter: "getConnected",
    },
    ref: {
      fn: "doRef",
    },
    unref: {
      fn: "doUnref",
    },
    flush: {
      fn: "doFlush",
    },
    queries: {
      getter: "getQueries",
      this: true,
    },
    onconnect: {
      getter: "getOnConnect",
      setter: "setOnConnect",
      this: true,
    },
    onclose: {
      getter: "getOnClose",
      setter: "setOnClose",
      this: true,
    },
  };
  const values = ["onconnect", "onclose", "queries"];

  // PostgreSQL-specific: NOTIFY/LISTEN support
  if (isPostgres) {
    proto.onnotification = {
      getter: "getOnNotification",
      setter: "setOnNotification",
      this: true,
    };
    values.push("onnotification");
  }

  classes.push(
    define({
      name: `${type}Connection`,
      construct: true,
      finalize: true,
      configurable: false,
      hasPendingActivity: isPostgres,
      klass: {
        //   escapeString: {
        //     fn: "escapeString",
        //   },
        //   escapeIdentifier: {
        //     fn: "escapeIdentifier",
        //   },
      },
      JSType: "0b11101110",
      proto,
      values,
    }),
  );

  classes.push(
    define({
      name: `${type}Query`,
      construct: true,
      finalize: true,
      configurable: false,
      JSType: "0b11101110",
      klass: {},
      proto: {
        run: {
          fn: "doRun",
          length: 2,
        },
        cancel: {
          fn: "doCancel",
          length: 0,
        },
        done: {
          fn: "doDone",
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
      },
      values: ["pendingValue", "target", "columns", "binding"],
      estimatedSize: true,
    }),
  );
}

export default classes;
