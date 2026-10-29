// RUN: link
// CHECK: expectedresult {{*}} type=Array<undefined|null|[[row]]> layouts={{*}} flags=[IsRowsOfQuery]
// CHECK: layout [[row]] name="Row"
// CHECK-NOT: IsNeverWritten
// CHECK: {key="name" {{*}} flags=[IsRequired]}]
// CHECK-LABEL: function {{*}}name="declared"
// CHECK: = Call {{*}}calleeName="own" expectedResult=
// CHECK-LABEL: function {{*}}name="field"
// CHECK: = Call {{*}}calleeName="holder.database" expectedResult=
// CHECK-LABEL: function {{*}}name="imported"
// CHECK: = Call {{*}}calleeName="sql" expectedResult=
// CHECK-LABEL: function {{*}}name="instance"
// CHECK: = Call {{*}}calleeName="own" expectedResult=
// CHECK-LABEL: function {{*}}name="member"
// CHECK: = Call {{*}}calleeName="Bun.sql" expectedResult=
// CHECK-LABEL: function {{*}}name="otherTag"
// CHECK-NOT: expectedResult=
// CHECK-LABEL: function {{*}}name="parameter"
// CHECK: = Call {{*}}calleeName="database" expectedResult=
// CHECK-LABEL: function {{*}}name="returned"
// CHECK: = Call {{*}}calleeName="own" expectedResult=
// CHECK-LABEL: function {{*}}name="transaction"
// CHECK-NOT: expectedResult=
// CHECK-LABEL: function {{*}}name="underKey"
// CHECK: = Call {{*}}calleeName="Bun.sql" expectedResult=
// CHECK-LABEL: function {{*}}name="untyped"
// CHECK-NOT: expectedResult=
// CHECK-LABEL: function {{*}}kind=Arrow
// CHECK: = Call {{*}}calleeName="inner" expectedResult=

// The signature that a call resolves to says that it answers a query, whatever holds the function. Nothing in the program makes a `Row`: the rows do.
import { sql, SQL } from "bun";

interface Row {
  id: number;
  name: string;
}

const own = new SQL("postgres://localhost/database");
const holder = { database: own };

export async function imported() {
  return (await sql<Row[]>`select`).length;
}

export async function member() {
  return (await Bun.sql<Row[]>`select`).length;
}

export async function underKey() {
  return (await Bun["sql"]<Row[]>`select`).length;
}

export async function instance() {
  return (await own<Row[]>`select`).length;
}

export async function field() {
  return (await holder.database<Row[]>`select`).length;
}

export async function parameter(database: SQL) {
  return (await database<Row[]>`select`).length;
}

export function transaction() {
  return own.begin(async inner => (await inner<Row[]>`select`).length);
}

export function returned() {
  return own<Row[]>`select`;
}

export async function declared() {
  const rows: Row[] = await own`select`;
  return rows.length;
}

export async function untyped() {
  return (await own`select`).length;
}

export function otherTag() {
  return String.raw`select`;
}
