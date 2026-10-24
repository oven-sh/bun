// Lists of constants: tables n. It prints what plain Bun prints.
declare const process: { argv: string[] };
declare const console: { log(...values: unknown[]): void };
const table: Record<string, number> = {
  ryooqsgfzqpu: 81546,
  zfdojecrzwubtm: 59402,
  uxtufta_qcbb: 16675,
  htayokos: 76974,
  qhujpavc: 63402,
  uinr_cwikyhq: 75310,
  acsydmdjm: 17791,
  avaggb: 50606,
  mwmncsugyvik: 23963,
  jkanyd: 82214,
  hwdaboz: 20202,
  fvrgoqgxyenu: 40738,
  dmngaizsjag: 29934,
  mtusdbe: 80012,
  oiaytk_j: 32702,
  cccgsuhatll: 95078,
};
function find(key: string) {
  return table[key];
}
const key = process.argv[2];
console.log(key ? find(key) : "none");
