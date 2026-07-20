import { Database } from "bun:sqlite";

const SMALL_QUERY = "SELECT value FROM hot WHERE id = ?";
const LONG_QUERY = `
  WITH RECURSIVE counter(value) AS (
    VALUES(1)
    UNION ALL
    SELECT value + 1 FROM counter WHERE value < ?
  )
  SELECT sum(value) AS total FROM counter
`;

let db;
let smallStatement;
let longStatement;

function setup() {
  db = new Database(":memory:");
  db.exec("CREATE TABLE hot (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO hot (id, value) VALUES (?, ?)");
  for (let id = 0; id < 256; id++) {
    insert.run(id, `value-${id}`);
  }
  insert.finalize();
  smallStatement = db.query(SMALL_QUERY);
  longStatement = db.query(LONG_QUERY);
}

function runSmall(operations) {
  let checksum = 0;
  for (let i = 0; i < operations; i++) {
    checksum += smallStatement.get([i & 255]).value.length;
  }
  return checksum;
}

function runLong(limit) {
  return longStatement.get([limit]).total;
}

onmessage = ({ data }) => {
  try {
    let result;
    switch (data.operation) {
      case "setup":
        setup();
        result = true;
        break;
      case "small":
        result = runSmall(data.operations);
        break;
      case "long":
        result = runLong(data.limit);
        break;
      case "close":
        db?.close();
        close();
        result = true;
        break;
      default:
        throw new Error(`Unknown operation: ${data.operation}`);
    }
    postMessage({ id: data.id, result });
  } catch (error) {
    postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
  }
};
