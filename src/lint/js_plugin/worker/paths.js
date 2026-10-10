// ───────────── paths ─────────────

// A path as the other side has it, with `/`, as the system writes it, `system` being `node:path`: that is how ESLint and oxlint
// have `context.filename`, and how `cwd` arrives.
function nativePath(path, system) {
  return system.sep === "/" ? path : path.replaceAll("/", system.sep);
}
