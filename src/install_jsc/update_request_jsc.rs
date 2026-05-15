//! JSC bridge for `bun.install.PackageManager.UpdateRequest`.

use bun_jsc::{JSGlobalObject, JSValue, JsResult};

pub fn from_js(global: &JSGlobalObject, input: JSValue) -> JsResult<JSValue> {
    use bun_ast::Log;
    use bun_install::Subcommand;
    use bun_install::package_manager::update_request::{self, UpdateRequest};

    // PERF(port): was arena bulk-free — profile in Phase B
    // PERF(port): was stack-fallback — profile in Phase B
    // PORT NOTE: `to_slice_clone` returns `ZigStringSlice`; convert to owned
    // `Vec<u8>` via `.into_vec()` since the Zig arena is gone.
    let mut all_positionals: Vec<Vec<u8>> = Vec::new();

    let mut log = Log::init();

    if input.is_string() {
        let input_str = input.to_slice_clone(global)?;
        if !input_str.slice().is_empty() {
            all_positionals.push(input_str.into_vec());
        }
    } else if input.is_array() {
        let mut iter = input.array_iterator(global)?;
        while let Some(item) = iter.next()? {
            let slice = item.to_slice_clone(global)?;
            if slice.slice().is_empty() {
                continue;
            }
            all_positionals.push(slice.into_vec());
        }
    } else {
        return Ok(JSValue::UNDEFINED);
    }

    if all_positionals.is_empty() {
        return Ok(JSValue::UNDEFINED);
    }

    let mut array = update_request::Array::default();

    // PORT NOTE: reshaped for borrowck — build a `&[&[u8]]` view over the owned buffers
    let positionals_view: Vec<&[u8]> = all_positionals.iter().map(|s| s.as_slice()).collect();

    let update_requests = match UpdateRequest::parse_with_error(
        None,
        &mut log,
        &positionals_view,
        &mut array,
        Subcommand::Add,
        false,
    ) {
        Ok(v) => v,
        Err(_) => {
            return Err(global.throw_value(crate::dependency_jsc::log_to_js(
                &log,
                global,
                b"Failed to parse dependencies",
            )?));
        }
    };
    if update_requests.is_empty() {
        return Ok(JSValue::UNDEFINED);
    }

    if !log.msgs.is_empty() {
        return Err(global.throw_value(crate::dependency_jsc::log_to_js(
            &log,
            global,
            b"Failed to parse dependencies",
        )?));
    }

    if update_requests[0].failed {
        return Err(global.throw(format_args!("Failed to parse dependencies")));
    }

    let object = JSValue::create_empty_object(global, 2);
    object.put(
        global,
        b"name",
        bun_jsc::bun_string_jsc::create_utf8_for_js(global, update_requests[0].name)?,
    );
    object.put(
        global,
        b"version",
        crate::dependency_jsc::version_to_js(
            &update_requests[0].version,
            update_requests[0].version_buf(),
            global,
        )?,
    );
    Ok(object)
}

// ported from: src/install_jsc/update_request_jsc.zig
