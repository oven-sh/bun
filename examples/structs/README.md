# Structs examples

Browser examples for the TC39 structs proposal. Each one bundles with `bun build`, which lowers
`struct` and `shared struct` to sealed classes and ships the small `__structBase` helper in the
bundle, so no browser support is needed.

| Example | What it shows |
| --- | --- |
| `vanilla-js` | A particle simulation on a canvas. `struct Vec2` and `struct Particle extends` a base struct, with sealed shapes. |
| `vanilla-ts` | The same model with typed fields, and a `shared struct` used for a counter. |
| `react` | Structs as the model behind a list, read through `useSyncExternalStore`. |
| `angular` | A standalone component whose state is a struct, bundled with Angular's JIT compiler. |

```sh
cd examples/structs/vanilla-js
bun build index.html --outdir dist
```

Struct fields cannot have initializers. Assign them in the constructor, where `this` is usable at once and
every declared field already exists as `undefined`.

In a browser the polyfill cannot share memory between Web Workers, so `shared struct` behaves as a single-agent
struct there: same shape and value rules, no cross-worker sharing. Native sharing needs a runtime that implements
the proposal, such as Bun with the native runtime support.
