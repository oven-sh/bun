// Loads one of four files, chosen by a number from the environment. The file that is loaded by default walks a list with `using` and stores each value into a field of the value itself. The other files declare records with fields of the same names.
const programs = [
  () => import("./walks-a-list.ts"),
  () => import("./first-records.ts"),
  () => import("./second-records.ts"),
  () => import("./third-records.ts"),
];
try {
  await programs[Number(process.env.CHOSEN_PROGRAM ?? 0)]();
} catch (error) {
  console.log(String(error));
}
