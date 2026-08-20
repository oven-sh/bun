//! Persistent worker-level test environments.

use bun_jsc::js_promise::Status as PromiseStatus;
use bun_jsc::virtual_machine::{TestEnvironmentLifecycle, TestEnvironmentState, VirtualMachine};
use bun_jsc::{
    self as jsc, AnyPromise, JSGlobalObject, JSModuleLoader, JSValue, ZigStringJsc,
};

pub(crate) fn configure(vm: &mut VirtualMachine, specifier: Option<&[u8]>) {
    vm.test_isolation_state.environment = specifier
        .map(|specifier| TestEnvironmentState::new(Box::<[u8]>::from(specifier)));
}

pub(crate) fn initialize(vm: &mut VirtualMachine) -> crate::Result<()> {
    let Some(state) = vm.test_isolation_state.environment.as_ref() else {
        return Ok(());
    };
    debug_assert_eq!(state.lifecycle, TestEnvironmentLifecycle::Uninitialized);

    let specifier = state.specifier.clone();
    let host_global = vm.global;
    let resolution = vm.transpiler.resolve_entry_point(&specifier)?;
    let resolved = bun_core::String::from_bytes(resolution.path_pair.primary.text);
    let promise = JSModuleLoader::import_ptr(host_global, &resolved)
        .map_err(|err| report_thrown(vm, host_global, err))?;
    let promise = promise.as_ptr();
    let _protected = JSValue::from_cell(promise).protected();
    let _ = vm.wait_for_promise(AnyPromise::Internal(promise));
    let host = JSGlobalObject::opaque_ref(host_global);
    if jsc::JSInternalPromise::opaque_mut(promise).status() == PromiseStatus::Rejected {
        let reason = jsc::JSInternalPromise::opaque_mut(promise).result(host.vm());
        vm.print_error_like_object_to_console(reason);
        return Err(crate::Error::JSError);
    }

    let namespace = jsc::JSInternalPromise::opaque_mut(promise).result(host.vm());
    let environment = namespace.get(host, b"default")?.ok_or_else(|| {
        bun_core::pretty_errorln!("<red>error<r>: test environment must have a default export");
        crate::Error::JSError
    })?;
    if !environment.is_object() {
        bun_core::pretty_errorln!(
            "<red>error<r>: test environment default export must be an object"
        );
        return Err(crate::Error::JSError);
    }
    let setup = environment.get(host, b"setup")?.ok_or_else(|| {
        bun_core::pretty_errorln!(
            "<red>error<r>: test environment default export must have a setup function"
        );
        crate::Error::JSError
    })?;
    if !setup.is_callable() {
        bun_core::pretty_errorln!("<red>error<r>: test environment setup must be callable");
        return Err(crate::Error::JSError);
    }

    let state = vm.test_isolation_state.environment.as_mut().unwrap();
    state.host_global = core::ptr::NonNull::new(host_global);
    state.environment_export.set(host, environment);
    state.lifecycle = TestEnvironmentLifecycle::Ready;
    vm.create_test_global_preserving_environment_host();
    Ok(())
}

pub(crate) fn setup_file(vm: &mut VirtualMachine, test_path: &[u8]) -> crate::Result<()> {
    let Some(state) = vm.test_isolation_state.environment.as_ref() else {
        return Ok(());
    };
    debug_assert_eq!(state.lifecycle, TestEnvironmentLifecycle::Ready);
    let host_ptr = state.host_global.expect("initialized environment host").as_ptr();
    let environment = state
        .environment_export
        .get()
        .expect("rooted environment export");
    let host = JSGlobalObject::opaque_ref(host_ptr);
    let setup = environment
        .get(host, b"setup")?
        .expect("setup was validated during environment initialization");

    let test_global = vm.global();
    let context = JSValue::create_empty_object(test_global, 1);
    context.put(
        test_global,
        b"testPath",
        bun_core::ZigString::from_utf8(test_path).to_js(test_global),
    );
    let result = setup
        .call(host, environment, &[test_global.to_js_value(), context])
        .map_err(|err| report_thrown(vm, host_ptr, err))?;
    let result = await_value(vm, host_ptr, result)?;

    if !result.is_undefined_or_null() {
        if result.is_callable() {
            // Function-form teardown is validated by callability itself.
        } else if result.is_object() {
            if let Some(teardown) = result.get(host, b"teardown")? {
                if !teardown.is_undefined() && !teardown.is_callable() {
                    bun_core::pretty_errorln!(
                        "<red>error<r>: test environment teardown must be callable"
                    );
                    return Err(crate::Error::JSError);
                }
            }
        } else {
            bun_core::pretty_errorln!(
                "<red>error<r>: test environment setup must return undefined, a function, or an object"
            );
            return Err(crate::Error::JSError);
        }
    }

    let state = vm.test_isolation_state.environment.as_mut().unwrap();
    state.file_handle.set(host, result);
    state.lifecycle = TestEnvironmentLifecycle::InFile;
    Ok(())
}

pub(crate) fn teardown_file(vm: &mut VirtualMachine) -> crate::Result<()> {
    let Some(state) = vm.test_isolation_state.environment.as_ref() else {
        return Ok(());
    };
    if state.lifecycle != TestEnvironmentLifecycle::InFile {
        return Ok(());
    }
    let host_ptr = state.host_global.expect("initialized environment host").as_ptr();
    let host = JSGlobalObject::opaque_ref(host_ptr);
    let handle = state.file_handle.get();

    let call = if let Some(handle) = handle {
        if handle.is_callable() {
            Some((handle, JSValue::UNDEFINED))
        } else if handle.is_object() {
            handle
                .get(host, b"teardown")?
                .filter(|teardown| !teardown.is_undefined())
                .map(|teardown| (teardown, handle))
        } else {
            None
        }
    } else {
        None
    };

    let result = if let Some((teardown, receiver)) = call {
        teardown
            .call(host, receiver, &[])
            .map_err(|err| report_thrown(vm, host_ptr, err))
            .and_then(|value| await_value(vm, host_ptr, value).map(|_| ()))
    } else {
        Ok(())
    };

    let state = vm.test_isolation_state.environment.as_mut().unwrap();
    state.file_handle.clear_without_deallocation();
    state.lifecycle = TestEnvironmentLifecycle::Ready;
    result
}

fn await_value(
    vm: &mut VirtualMachine,
    global_ptr: *mut JSGlobalObject,
    value: JSValue,
) -> crate::Result<JSValue> {
    let Some(promise) = value.as_any_promise() else {
        return Ok(value);
    };
    let _ = vm.wait_for_promise(promise);
    let global = JSGlobalObject::opaque_ref(global_ptr);
    if promise.status() == PromiseStatus::Rejected {
        vm.print_error_like_object_to_console(promise.result(global.vm()));
        return Err(crate::Error::JSError);
    }
    Ok(promise.result(global.vm()))
}

fn report_thrown(
    vm: &mut VirtualMachine,
    global_ptr: *mut JSGlobalObject,
    err: jsc::JsError,
) -> crate::Error {
    let global = JSGlobalObject::opaque_ref(global_ptr);
    vm.print_error_like_object_to_console(global.take_exception(err));
    crate::Error::JSError
}
