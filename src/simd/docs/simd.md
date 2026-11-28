Marks what kernels use: a function, a type, an `impl`, a trait, a constant, or a module with all its functions and methods.

It declares the type parameter `S`, the target, after the others. Types say it, as in `fn f(v: u8xN<S>)`, `impl Finder<S>` and `f::<3, S>(v)`. So do constants, `S::N`, and lengths, `[u8; 2 * S::N]`. Expressions don't: in `u8xN::splat(1)`, `over(x)` and `f(v)` the compiler infers it.
Functions and their closures have the instructions of the target, and are inlined unless they have `#[inline(never)]` or `#[cold]`. In a module, a type, trait, `impl` or constant has `S` if it names it.

On a module, `#[simd(icelake, avx2 + vaes, avx2, neon + aes, neon)]` names the targets of its kernels. The first that the CPU has wins, and
`portable` ends each list. `#[simd]` is `#[simd(icelake, avx2 + aes, sse4, neon, wasm + relaxed, wasm)]`, for which `default` stands in a list. What comes twice counts where it is first.
[The page on targets](mod@crate::target) has all words.

A path takes the targets of another such module: `#[simd(super)]`, `#[simd(crate::codec)]`, `#[simd(other_crate::simd)]`. [`targets!`](macro@crate::targets) names them for several files.

[This page](crate::guide::programs#what-the-attributes-write) shows an expansion.

| On an item | |
| --- | --- |
| [`#[kernel]`](macro@crate::kernel) | A function or method that runs on the best target. |
| `#[kernel(icelake, neon)]` | The same, with a list of its own. |
| `#[shared]` | Left as it is written: for a function, `impl`, trait or module that gains nothing from a target, or that other code calls. So are tests, unless they are kernels. |
| `#[only(avx2 + sha \| neon)]`| For the targets that have all words of one entry. A comma means the same as `\|`. `core::arch` is safe to call. |
| `#[except(avx512)]` | For the others. Functions of one name with these attributes are twins, in a module or `impl` with `#[simd]`. One without is for all targets that are left. Visibility and other attributes are the same, but for `inline`, `cold`, lints and comments. A call on a target that none fits fails to build. |
| `#[simd(by_level)]` | On a function or `impl`: it knows the lengths that say `S` in the types that it uses. |

A `macro_rules!` can write marked items, without `unsafe` in them. If it is from another crate, it has to write the attribute itself, by its name, and the keyword (else E0742), and rustc has to find its file. Start the path with `$crate`, also for marks within and for derives. The first also holds for items of traits (E0449). Unsafe code in the macro must not rely on the results of these items.

A macro that has or writes `#[macro_export]`, or has an unknown attribute, stays as it is written, and takes `#[shared]` if it has closures or functions.
