import Pappa from "papaparse";
// Example usage:
// const rows = fetchCSV(
//   "https://covid19.who.int/WHO-COVID-19-global-data.csv",
//   {
//     last: 100,
//     columns: ["New_cases", "Date_reported", "Country"],
//   }
// );
export async function fetchCSV(callExpression) {
  console.time("fetchCSV Total");
  const [
    urlNode,
    {
      properties: { last: limit = 10, columns = [] },
    },
  ] = callExpression.arguments;
  const url = urlNode.get();

  console.time("Fetch");
  const response = await fetch(url);
  const csvText = await response.text();
  console.timeEnd("Fetch");

  console.time("Parse");
  let rows = Pappa.parse(csvText, { fastMode: true }).data;
  console.timeEnd("Parse");

  console.time("Render");
  const columnIndices = new Array(columns.length);

  for (let i = 0; i < columns.length; i++) {
    columnIndices[i] = rows[0].indexOf(columns[i]);
  }

  rows = rows
    .slice(Math.max(limit, rows.length) - limit)
    .reverse()
    .filter(columns => columns.every(Boolean));
  const value = (
    <array>
      {rows.map(columns => (
        <array>
          {columnIndices.map(columnIndex => (
            <string value={columns[columnIndex]} />
          ))}
        </array>
      ))}
    </array>
  );
  console.timeEnd("Render");
  console.timeEnd("fetchCSV Total");
  return value;
}
