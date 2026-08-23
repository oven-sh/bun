use core::sync::atomic::Ordering;

use bun_jsc::virtual_machine::VirtualMachine;
use bun_options_types::context::RuntimeOptions;

/// # Safety
///
/// `runtime_options` must outlive `vm` because profiler configs borrow its CLI
/// argument storage until the VM writes profiles during shutdown.
pub(crate) unsafe fn configure(vm: &mut VirtualMachine, runtime_options: &RuntimeOptions) {
    if runtime_options.cpu_prof.enabled {
        let opts = &runtime_options.cpu_prof;
        // SAFETY: upheld by the caller; the runtime options outlive the VM.
        let name: &'static [u8] = unsafe { &*std::ptr::from_ref::<[u8]>(opts.name.as_ref()) };
        // SAFETY: upheld by the caller; the runtime options outlive the VM.
        let dir: &'static [u8] = unsafe { &*std::ptr::from_ref::<[u8]>(opts.dir.as_ref()) };
        vm.cpu_profiler_config = Some(bun_jsc::bun_cpu_profiler::CPUProfilerConfig {
            name,
            dir,
            md_format: opts.md_format,
            json_format: opts.json_format,
            interval: opts.interval,
        });
        bun_jsc::bun_cpu_profiler::set_sampling_interval(opts.interval);
        // SAFETY: `vm.jsc_vm` is initialized before profiler configuration.
        bun_jsc::bun_cpu_profiler::start_cpu_profiler(unsafe { &mut *vm.jsc_vm });
        bun_analytics::features::cpu_profile.fetch_add(1, Ordering::Relaxed);
    }

    if runtime_options.heap_prof.enabled {
        let opts = &runtime_options.heap_prof;
        // SAFETY: upheld by the caller; the runtime options outlive the VM.
        let name: &'static [u8] = unsafe { &*std::ptr::from_ref::<[u8]>(opts.name.as_ref()) };
        // SAFETY: upheld by the caller; the runtime options outlive the VM.
        let dir: &'static [u8] = unsafe { &*std::ptr::from_ref::<[u8]>(opts.dir.as_ref()) };
        vm.heap_profiler_config = Some(bun_jsc::bun_heap_profiler::HeapProfilerConfig {
            name,
            dir,
            text_format: opts.text_format,
        });
        bun_analytics::features::heap_snapshot.fetch_add(1, Ordering::Relaxed);
    }
}
