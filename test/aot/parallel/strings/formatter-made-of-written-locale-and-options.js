// formatters are made of a written locale and written options, used, asked for their options, and told apart; one gets options whose getter counts, one options that are changed before the call
// Env: TZ=America/New_York
let reads = 0;
function number() { return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }); }
function money() { return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }); }
function date() { return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }); }
function counted() { return new Intl.NumberFormat("en-US", { get style() { reads++; return "percent"; } }); }
function changed() { const options = { style: "percent" }; options.style = "decimal"; return new Intl.NumberFormat("en-US", options); }
function refused() { try { return new Intl.NumberFormat("en-US", { style: "nonsense" }); } catch (e) { return e.name; } }
for (let turn = 0; turn < 3; turn++) {
  console.log(number().format(0.1234), money().format(1234.5), date().format(new Date(86400000 * 365)), counted().format(0.5), reads, changed().format(0.5), String(refused()));
  console.log(number() === number(), number() instanceof Intl.NumberFormat, JSON.stringify(number().resolvedOptions().style), JSON.stringify(date().resolvedOptions().timeZone), number().format(NaN), number().format(1e21), date().format(new Date(-1e14)));
}
