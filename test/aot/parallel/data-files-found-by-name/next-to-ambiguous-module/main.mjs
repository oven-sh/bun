import "./silent.cjs";
const rows = [{ name: "./good.json" }];
import.meta.require("./touch.cjs")(rows[0]);
for (const row of rows) {
  try {
    console.log(row.name, JSON.stringify(import.meta.require(row.name)));
  } catch (error) {
    console.log(row.name, "threw", error.name);
  }
}
