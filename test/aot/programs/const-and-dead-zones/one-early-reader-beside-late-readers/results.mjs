export const results = [];
export function attempt(label, run) {
  try {
    results.push([label, JSON.stringify(run())]);
  } catch (error) {
    results.push([label, error.constructor.name]);
  }
}
