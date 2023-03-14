import { fetchCSV } from "macro:fetchCSV";

export const Covid19 = () => {
  const rows = fetchCSV("https://covid19.who.int/WHO-COVID-19-global-data.csv", {
    last: 100,
    columns: ["New_cases", "Date_reported", "Country"],
  });

  return (
    <div>
      <h2>Covid-19</h2>
      <h6>last {rows.length} updates from the WHO</h6>
      <div className="Table">
        <div className="Header">
          <div className="Heading">New Cases</div>
          <div className="Heading">Date</div>
          <div className="Heading">Country</div>
        </div>

        {rows.map((row, index) => (
          <div className="Row" key={index}>
            <div className="Column">{row[0]}</div>
            <div className="Column">{row[1]}</div>
            <div className="Column">{row[2]}</div>
          </div>
        ))}
      </div>
    </div>
  );
};
