/// Opt-in type declarations for `import ... with { type: "bundle" }`.
/// Add to tsconfig.json: { "types": ["bun-types", "bun-types/bundle-imports"] }
///
/// Note: This declares default exports on common file extensions as JSBundle.
/// If you import these extensions normally (without `with { type: "bundle" }`),
/// TypeScript will still show JSBundle as the type — this is a TS limitation.

declare module "*.tsx" {
  const bundle: import("bun").JSBundle;
  export default bundle;
}

declare module "*.jsx" {
  const bundle: import("bun").JSBundle;
  export default bundle;
}

declare module "*.ts" {
  const bundle: import("bun").JSBundle;
  export default bundle;
}

declare module "*.js" {
  const bundle: import("bun").JSBundle;
  export default bundle;
}
