const shown = (number: number) => (Math.abs(number) >= 100 ? Math.round(number) : Number(number.toPrecision(3)));

/**
 * Says what a test has read and the bound that it holds it to, also where the test passes. The runner keeps the line,
 * so a reading that nears its bound shows in the logs before it passes it.
 */
export function reads(what: string, read: number, bound: number, unit: string) {
  const share = Math.round((read / bound) * 100);
  console.error(`READS ${what}: ${shown(read)} of at most ${shown(bound)} ${unit} (${share}%)`);
}
