> ⚠️ Note: This is an advanced and experimental API recommended only for plugin developers who are familiar with systems proramming and the C ABI. Use with caution.

# Bun Native Plugins

This crate provides a Rustified wrapper over the Bun's native bundler plugin C API.

Some advantages to _native_ bundler plugins as opposed to regular ones implemented in JS:

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

Now, inside the `lib.rs` file, expose a C ABI function which has the same function signature as the plugin lifecycle hook that you want to implement.

For example, implementing `onBeforeParse`:

```rs
use bun_native_plugin::{define_bun_plugin, OnBeforeParse};
use napi_derive::napi;

/// Define with the name of the plugin
define_bun_plugin!("replace-foo-with-bar");

/// This is necessary for napi-rs to compile this into a proper NAPI module
#[napi]
pub fn register_bun_plugin() {}

/// Use `no_mangle` so that we can reference this symbol by name later
/// when registering this native plugin in JS.
///
/// Here we'll create a dummy plugin which replaces all occurences of
/// `foo` with `bar`
#[no_mangle]
pub extern "C" fn on_before_parse_plugin_impl(
  args: *const bun_native_plugin::sys::OnBeforeParseArguments,
  result: *mut bun_native_plugin::sys::OnBeforeParseResult,
) {
  let args = unsafe { &*args };

  // This returns a handle which is a safe wrapper over the raw
  // C API.
  let mut handle = OnBeforeParse::from_raw(args, result) {
    Ok(handle) => handle,
    Err(_) => {
      // `OnBeforeParse::from_raw` handles error logging
      // so it fine to return here.
      return;
    }
  };

  let input_source_code = match handle.input_source_code() {
    Ok(source_str) => source_str,
    Err(_) => {
      // If we encounter an error, we must log it so that
      // Bun knows this plugin failed.
      handle.log_error("Failed to fetch source code!");
      return;
    }
  };

  let loader = handle.output_loader();
  let output_source_code = source_str.replace("foo", "bar");
  handle.set_output_source_code(output_source_code, loader);
}
```

Then compile this NAPI module. If you using napi-rs, the `package.json` should have a `build` script you can run:

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
          { napiModule, symbol: "on_before_parse_plugin_impl" },
        );
      },
    },
  ],
});
```

## Very important information

### Error handling and panics

It is highly recommended to avoid panicking as this will crash the runtime. Instead, you must handle errors and log them:

```rs
let input_source_code = match handle.input_source_code() {
  Ok(source_str) => source_str,
  Err(_) => {
    // If we encounter an error, we must log it so that
    // Bun knows this plugin failed.
    handle.log_error("Failed to fetch source code!");
    return;
  }
};
```

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
pub extern "C" fn on_before_parse_plugin_impl(
  args: *const bun_native_plugin::sys::OnBeforeParseArguments,
  result: *mut bun_native_plugin::sys::OnBeforeParseResult,
) {
  let args = unsafe { &*args };

  let mut handle = OnBeforeParse::from_raw(args, result) {
    Ok(handle) => handle,
    Err(_) => {
      // `OnBeforeParse::from_raw` handles error logging
      // so it fine to return here.
      return;
    }
  };

  let plugin_state: &PluginState =
    // This operation is only safe if you pass in an external when registering the plugin.
    // If you don't, this could lead to a segfault or access of undefined memory.
    match unsafe { handle.external().and_then(|state| state.ok_or(Error::Unknown)) } {
      Ok(state) => state,
      Err(_) => {
        handle.log_error("Failed to get external!");
        return;
      }
    };


  // Fetch our source code again
  let input_source_code = match handle.input_source_code() {
    Ok(source_str) => source_str,
    Err(_) => {
      handle.log_error("Failed to fetch source code!");
      return;
    }
  };

  // Count the number of `foo`s and add it to our state
  let foo_count = source_code.matches("foo").count() as u32;
  plugin_state.foo_count.fetch_add(foo_count, std::sync::atomic::Ordering::Relaxed);
}
```

### Concurrency

Your `extern "C"` plugin function can be called _on any thread_ at _any time_ and _multiple times at once_.

Therefore, you must design any state management to be threadsafe
