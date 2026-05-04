//! JSC bridge for `bun.install.PackageManager.UpdateRequest`.

use bun_install::package_manager::update_request::{self, UpdateRequest};
use bun_jsc::{JSGlobalObject, JSValue, JsResult};
use bun_logger::Log;
use bun_str::String as BunString;

pub fn from_js(global: &JSGlobalObject, input: JSValue) -> JsResult<JSValue> {
    // PERF(port): was arena bulk-free — profile in Phase B
    // PERF(port): was stack-fallback — profile in Phase B
    // TODO(port): `to_slice_clone` exact return type — Zig `toSliceCloneWithAllocator` yields
    // `ZigString.Slice` (len + slice()); here we keep owned `Box<[u8]>` since the arena is gone.
    let mut all_positionals: Vec<Box<[u8]>> = Vec::new();

    let mut log = Log::init();

    if input.is_string() {
        let input_str = input.to_slice_clone(global)?;
        if input_str.len() > 0 {
            all_positionals.push(input_str.into_bytes());
        }
    } else if input.is_array() {
        let mut iter = input.array_iterator(global)?;
        while let Some(item) = iter.next(global)? {
            let slice = item.to_slice_clone(global)?;
            if slice.len() == 0 {
                continue;
            }
            all_positionals.push(slice.into_bytes());
        }
    } else {
        return Ok(JSValue::UNDEFINED);
    }

    if all_positionals.is_empty() {
        return Ok(JSValue::UNDEFINED);
    }

    let mut array = update_request::Array::default();

    // PORT NOTE: reshaped for borrowck — build a `&[&[u8]]` view over the owned buffers
    let positionals_view: Vec<&[u8]> = all_positionals.iter().map(|s| s.as_ref()).collect();

    let update_requests = match UpdateRequest::parse_with_error(
        None,
        &mut log,
        &positionals_view,
        &mut array,
        // TODO(port): `.add` enum literal — confirm exact Rust path for the subcommand enum
        bun_install::Subcommand::Add,
        false,
    ) {
        Ok(v) => v,
        Err(_) => {
            return global.throw_value(log.to_js(global, "Failed to parse dependencies")?);
        }
    };
    if update_requests.is_empty() {
        return Ok(JSValue::UNDEFINED);
    }

    if !log.msgs.is_empty() {
        return global.throw_value(log.to_js(global, "Failed to parse dependencies")?);
    }

    if update_requests[0].failed {
        return global.throw(format_args!("Failed to parse dependencies"));
    }

    let object = JSValue::create_empty_object(global, 2);
    let mut name_str = BunString::init(&update_requests[0].name);
    object.put(global, "name", name_str.transfer_to_js(global)?);
    object.put(
        global,
        "version",
        update_requests[0]
            .version
            .to_js(&update_requests[0].version_buf, global)?,
    );
    Ok(object)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install_jsc/update_request_jsc.zig (61 lines)
//   confidence: medium
//   todos:      2
//   notes:      arena+stackfallback dropped; positionals reshaped to Vec<Box<[u8]>> + view; confirm Subcommand::Add path and JSValue::to_slice_clone return type
// ──────────────────────────────────────────────────────────────────────────
