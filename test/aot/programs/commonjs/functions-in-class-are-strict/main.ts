import { rows } from "./sloppy.cjs";
for (const [name, row] of Object.entries(rows as Record<string, () => unknown>)) {
  try {
    console.log(name + ": " + row());
  } catch (error) {
    console.log(name + ": " + (error as Error).constructor.name);
  }
}
