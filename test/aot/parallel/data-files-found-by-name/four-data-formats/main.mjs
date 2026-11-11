const rows = [{ name: "./good.json" }, { name: "./note.txt" }, { name: "./good.toml" }, { name: "./good.yaml" }, { name: "./one.cjs" }];
import.meta.require("./touch.cjs")(rows[0]);
for (const row of rows) {
  try {
    console.log(row.name, JSON.stringify(import.meta.require(row.name)));
  } catch (error) {
    console.log(row.name, "threw", error.name);
  }
}
