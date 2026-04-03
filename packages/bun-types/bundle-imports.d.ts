/// Opt-in type declarations for `import ... from "...?bundle"`.
/// Add to tsconfig.json: { "types": ["bun-types", "bun-types/bundle-imports"] }

declare module "*?bundle" {
  const bundle: import("bun").JSBundle;
  export default bundle;
}
