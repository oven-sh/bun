import { eachRow } from "each-row";

interface Row {
  name: string;
}

eachRow<Row>([{ name: "Ada" }], (row: Row) => console.log(row.name));
