use core::sync::atomic::Ordering;

use bun_jsc::virtual_machine::VirtualMachine;
use bun_options_types::context::RuntimeOptions;

/// Call on the JS thread while holding the JSC API lock.
pub(crate) fn configure(vm: &mut VirtualMachine, runtime_options: &RuntimeOptions) {
    if runtime_options.cpu_prof.enabled {
        let opts = &runtime_options.cpu_prof;
        vm.cpu_profiler_config = Some(bun_jsc::bun_cpu_profiler::CPUProfilerConfig {
            name: opts.name.clone(),
            dir: opts.dir.clone(),
            md_format: opts.md_format,
            json_format: opts.json_format,
            interval: opts.interval,
        });
        bun_jsc::bun_cpu_profiler::set_sampling_interval(opts.interval);
        bun_jsc::bun_cpu_profiler::start_cpu_profiler(vm.jsc_vm_mut());
        bun_analytics::features::cpu_profile.fetch_add(1, Ordering::Relaxed);
    }

    if runtime_options.heap_prof.enabled {
        let opts = &runtime_options.heap_prof;
        vm.heap_profiler_config = Some(bun_jsc::bun_heap_profiler::HeapProfilerConfig {
            name: opts.name.clone(),
            dir: opts.dir.clone(),
            text_format: opts.text_format,
        });
        bun_analytics::features::heap_snapshot.fetch_add(1, Ordering::Relaxed);
    }
}
