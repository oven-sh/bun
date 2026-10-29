let bodies = [];
let settlements = [];
let tracked = [];
let errors = new Set();

export function ran(label) {
  bodies.push(label);
}

export function track(label, imported) {
  tracked.push(
    imported.then(
      namespace => {
        settlements.push(`${label}: fulfilled, finished ${namespace.finished}`);
      },
      error => {
        errors.add(error);
        settlements.push(`${label}: rejected, ${error.message}`);
      },
    ),
  );
}

export async function scenario(title, load) {
  let outcome = "fulfilled";
  try {
    await load();
  } catch (error) {
    errors.add(error);
    outcome = `rejected, ${error.message}`;
  }
  await Promise.all(tracked);
  console.log(`${title}: ${outcome}`);
  console.log(`  bodies: ${bodies.join(", ")}`);
  for (const settlement of settlements) console.log(`  ${settlement}`);
  console.log(`  distinct errors: ${errors.size}`);
  bodies = [];
  settlements = [];
  tracked = [];
  errors = new Set();
}
