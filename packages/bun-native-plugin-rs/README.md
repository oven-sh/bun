> ⚠️ Note: This is an advanced and experimental API recommended only for plugin developers who are familiar with systems programming and the C ABI. Use with caution.

# Bun Native Plugins

This crate provides a Rustified wrapper over the Bun's native bundler plugin C API.

Some advantages to _native_ bundler plugins as opposed to regular ones implemented in JS are:

- Native plugins take full advantage of Bun's parallelized bundler pipeline and run on multiple threads at the same time
- Unlike JS, native plugins don't need to do the UTF-8 <-> UTF-16 source code string conversions

What are native bundler plugins exactly? Precisely, they are NAPI modules which expose a C ABI function which implement a plugin lifecycle hook.

The currently supported lifecycle hooks are:

- `onBeforeParse` (called immediately before a file is parsed, allows you to modify the source code of the file)

## Getting started

Since native bundler plugins are NAPI modules, the easiest way to get started is to create a new [napi-rs](https://github.com/napi-rs/napi-rs) project:

```bash
bun add -g @napi-rs/cli
napi new
```

Then install this crate:

```bash
cargo add bun-native-plugin
```

Now, inside the `lib.rs` file, we'll use the `bun_native_plugin::bun` proc macro to define a function which
will implement our native plugin.

Here's an example implementing the `onBeforeParse` hook:

```rs
use bun_native_plugin::{define_bun_plugin, OnBeforeParse, bun, Result, anyhow, BunLoader};
use napi_derive::napi;

/// Define the plugin and its name
define_bun_plugin!("replace-foo-with-bar");

/// Here we'll implement `onBeforeParse` with code that replaces all occurrences of
/// `foo` with `bar`.
///
/// We use the #[bun] macro to generate some of the boilerplate code.
///
/// The argument of the function (`handle: &mut OnBeforeParse`) tells
/// the macro that this function implements the `onBeforeParse` hook.
#[bun]
pub fn replace_foo_with_bar(handle: &mut OnBeforeParse) -> Result<()> {
  // Fetch the input source code.
  let input_source_code = handle.input_source_code()?;

  // Get the Loader for the file
  let loader = handle.output_loader();


  let output_source_code = input_source_code.replace("foo", "bar");

  handle.set_output_source_code(output_source_code, BunLoader::BUN_LOADER_JSX);

  Ok(())
}
```

Internally, the `#[bun]` macro wraps your code and declares a C ABI function which implements
the function signature of `onBeforeParse` plugins in Bun's C API for bundler plugins.

Then it calls your code. The wrapper looks _roughly_ like this:

```rs
pub extern "C" fn replace_foo_with_bar(
  args: *const bun_native_plugin::sys::OnBeforeParseArguments,
  result: *mut bun_native_plugin::sys::OnBeforeParseResult,
) {
  // The actual code you wrote is inlined here
  fn __replace_foo_with_bar(handle: &mut OnBeforeParse) -> Result<()> {
    // Fetch the input source code.
    let input_source_code = handle.input_source_code()?;

    // Get the Loader for the file
    let loader = handle.output_loader();


    let output_source_code = input_source_code.replace("foo", "bar");

    handle.set_output_source_code(output_source_code, BunLoader::BUN_LOADER_JSX);

    Ok(())
  }

  let args = unsafe { &*args };

  let mut handle = OnBeforeParse::from_raw(args, result) {
    Ok(handle) => handle,
    Err(_) => {
      return;
    }
  };

  if let Err(e) = __replace_fo_with_bar(&handle) {
    handle.log_err(&e.to_string());
  }
}
```

Now, let's compile this NAPI module. If you're using napi-rs, the `package.json` should have a `build` script you can run:

```bash
bun run build
```

This will produce a `.node` file in the project directory.

With the compiled NAPI module, you can now register the plugin from JS:

```js
const result = await Bun.build({
  entrypoints: ["index.ts"],
  plugins: [
    {
      name: "replace-foo-with-bar",
      setup(build) {
        const napiModule = require("path/to/napi_module.node");

        // Register the `onBeforeParse` hook to run on all `.ts` files.
        // We tell it to use function we implemented inside of our `lib.rs` code.
        build.onBeforeParse(
          { filter: /\.ts/ },
          { napiModule, symbol: "replace_foo_with_bar" },
        );
      },
    },
  ],
});
```

## Very important information

### Error handling and panics

In the case that the value of the `Result` your plugin function returns is an `Err(...)`, the error will be logged to Bun's bundler.

It is highly advised that you return all errors and avoid `.unwrap()`'ing or `.expecting()`'ing results.

The `#[bun]` wrapper macro actually runs your code inside of a [`panic::catch_unwind`](https://doc.rust-lang.org/std/panic/fn.catch_unwind.html),
which may catch _some_ panics but **not guaranteed to catch all panics**.

Therefore, it is recommended to **avoid panics at all costs**.

### Passing state to and from JS: `External`

One way to communicate data from your plugin and JS and vice versa is through the NAPI's [External](https://napi.rs/docs/concepts/external) type.

An External in NAPI is like an opaque pointer to data that can be passed to and from JS. Inside your NAPI module, you can retrieve
the pointer and modify the data.

As an example that extends our getting started example above, let's say you wanted to count the number of `foo`'s that the native plugin encounters.

You would expose a NAPI module function which creates this state. Recall that state in native plugins must be threadsafe. This usually means
that your state must be `Sync`:

```rs
struct PluginState {
  foo_count: std::sync::atomic::AtomicU32,
}

#[napi]
pub fn create_plugin_state() -> External<PluginState> {
  let external = External::new(PluginState {
    foo_count: 0,
  });

  external
}


#[napi]
pub fn get_foo_count(plugin_state: External<PluginState>) -> u32 {
  let plugin_state: &PluginState = &plugin_state;
  plugin_state.foo_count.load(std::sync::atomic::Ordering::Relaxed)
}
```

When you register your plugin from Javascript, you call the napi module function to create the external and then pass it:

```js
const napiModule = require("path/to/napi_module.node");
const pluginState = napiModule.createPluginState();

const result = await Bun.build({
  entrypoints: ["index.ts"],
  plugins: [
    {
      name: "replace-foo-with-bar",
      setup(build) {
        build.onBeforeParse(
          { filter: /\.ts/ },
          {
            napiModule,
            symbol: "on_before_parse_plugin_impl",
            // pass our NAPI external which contains our plugin state here
            external: pluginState,
          },
        );
      },
    },
  ],
});

console.log("Total `foo`s encountered: ", pluginState.getFooCount());
```

Finally, from the native implementation of your plugin, you can extract the external:

```rs
#[bun]
pub fn on_before_parse_plugin_impl(handle: &mut OnBeforeParse) {
    // This operation is only safe if you pass in an external when registering the plugin.
    // If you don't, this could lead to a segfault or access of undefined memory.
  let plugin_state: &PluginState =
     unsafe { handle.external().and_then(|state| state.ok_or(Error::Unknown))? };


  // Fetch our source code again
  let input_source_code = handle.input_source_code()?;

  // Count the number of `foo`s and add it to our state
  let foo_count = source_code.matches("foo").count() as u32;
  plugin_state.foo_count.fetch_add(foo_count, std::sync::atomic::Ordering::Relaxed);
}
```

### Concurrency

Your plugin function can be called _on any thread_ at _any time_ and possibly _multiple times at once_.

Therefore, you must design any state management to be threadsafe.
