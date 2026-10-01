// A check that reports nothing: it measures what the runner costs without a child process.
export default async function check() {
  return { diagnostics: [] };
}
