// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const show = (value: unknown): string =>
  Object.is(value, -0)
    ? "-0"
    : typeof value === "string" || (typeof value === "object" && value !== null)
      ? JSON.stringify(value)
      : String(value);
const report = (label: string, probe: () => unknown): void => {
  let text: string;
  try {
    text = show(probe());
  } catch (error) {
    text = "threw " + (error as Error).constructor.name;
  }
  console.log(label + ": " + text);
};
const dates = new Intl.DateTimeFormat("en-US", { timeZone: "UTC" });
const numbers = new Intl.NumberFormat("en-US");
function formatDate(time: number): string {
  try {
    return dates.format(time);
  } catch (error) {
    return "caught " + (error as Error).name;
  }
}
function formatNumber(value: number): string {
  try {
    return numbers.format(value);
  } catch (error) {
    return "caught " + (error as Error).name;
  }
}
report("dates", () => [formatDate(0), formatDate(NaN), formatDate(Infinity), formatDate(86400000)]);
report("numbers", () => [formatNumber(0.5), formatNumber(NaN), formatNumber(-Infinity), formatNumber(-0)]);
