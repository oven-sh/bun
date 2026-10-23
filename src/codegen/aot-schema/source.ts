/** The classes are the engine's (JavaScriptCore/aot/ir/generator/source.ts). These stand for them on the right of `instanceof`. */
function errorsNamed(name: string) {
  return { [Symbol.hasInstance]: (value: unknown): value is Error => value instanceof Error && value.name === name };
}

export const SchemaError = errorsNamed("SchemaError");
export const SchemaErrors = errorsNamed("SchemaErrors");
