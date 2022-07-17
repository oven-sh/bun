// GENERATED FILE
// #include <mach/mach.h>
const std = @import("std");

pub const int_least8_t = i8;
pub const int_least16_t = i16;
pub const int_least32_t = i32;
pub const int_least64_t = i64;
pub const uint_least8_t = u8;
pub const uint_least16_t = u16;
pub const uint_least32_t = u32;
pub const uint_least64_t = u64;
pub const int_fast8_t = i8;
pub const int_fast16_t = i16;
pub const int_fast32_t = i32;
pub const int_fast64_t = i64;
pub const uint_fast8_t = u8;
pub const uint_fast16_t = u16;
pub const uint_fast32_t = u32;
pub const uint_fast64_t = u64;
pub const __int8_t = i8;
pub const __uint8_t = u8;
pub const __int16_t = c_short;
pub const __uint16_t = c_ushort;
pub const __int32_t = c_int;
pub const __uint32_t = c_uint;
pub const __int64_t = c_longlong;
pub const __uint64_t = c_ulonglong;
pub const __darwin_intptr_t = c_long;
pub const __darwin_natural_t = c_uint;
pub const __darwin_ct_rune_t = c_int;
pub const __mbstate_t = extern union {
    __mbstate8: [128]u8,
    _mbstateL: c_longlong,
};
pub const __darwin_mbstate_t = __mbstate_t;
pub const __darwin_ptrdiff_t = c_long;
pub const __darwin_size_t = c_ulong;
pub const __darwin_wchar_t = c_int;
pub const __darwin_rune_t = __darwin_wchar_t;
pub const __darwin_wint_t = c_int;
pub const __darwin_clock_t = c_ulong;
pub const __darwin_socklen_t = __uint32_t;
pub const __darwin_ssize_t = c_long;
pub const __darwin_time_t = c_long;
pub const __darwin_blkcnt_t = __int64_t;
pub const __darwin_blksize_t = __int32_t;
pub const __darwin_dev_t = __int32_t;
pub const __darwin_fsblkcnt_t = c_uint;
pub const __darwin_fsfilcnt_t = c_uint;
pub const __darwin_gid_t = __uint32_t;
pub const __darwin_id_t = __uint32_t;
pub const __darwin_ino64_t = __uint64_t;
pub const __darwin_ino_t = __darwin_ino64_t;
pub const __darwin_mach_port_name_t = __darwin_natural_t;
pub const __darwin_mach_port_t = __darwin_mach_port_name_t;
pub const __darwin_mode_t = __uint16_t;
pub const __darwin_off_t = __int64_t;
pub const __darwin_pid_t = __int32_t;
pub const __darwin_sigset_t = __uint32_t;
pub const __darwin_suseconds_t = __int32_t;
pub const __darwin_uid_t = __uint32_t;
pub const __darwin_useconds_t = __uint32_t;
pub const __darwin_uuid_t = [16]u8;
pub const __darwin_uuid_string_t = [37]u8;
pub const struct___darwin_pthread_handler_rec = extern struct {
    __routine: ?fn (?*anyopaque) callconv(.C) void,
    __arg: ?*anyopaque,
    __next: [*c]struct___darwin_pthread_handler_rec,
};
pub const struct__opaque_pthread_attr_t = extern struct {
    __sig: c_long,
    __opaque: [56]u8,
};
pub const struct__opaque_pthread_cond_t = extern struct {
    __sig: c_long,
    __opaque: [40]u8,
};
pub const struct__opaque_pthread_condattr_t = extern struct {
    __sig: c_long,
    __opaque: [8]u8,
};
pub const struct__opaque_pthread_mutex_t = extern struct {
    __sig: c_long,
    __opaque: [56]u8,
};
pub const struct__opaque_pthread_mutexattr_t = extern struct {
    __sig: c_long,
    __opaque: [8]u8,
};
pub const struct__opaque_pthread_once_t = extern struct {
    __sig: c_long,
    __opaque: [8]u8,
};
pub const struct__opaque_pthread_rwlock_t = extern struct {
    __sig: c_long,
    __opaque: [192]u8,
};
pub const struct__opaque_pthread_rwlockattr_t = extern struct {
    __sig: c_long,
    __opaque: [16]u8,
};
pub const struct__opaque_pthread_t = extern struct {
    __sig: c_long,
    __cleanup_stack: [*c]struct___darwin_pthread_handler_rec,
    __opaque: [8176]u8,
};
pub const __darwin_pthread_attr_t = struct__opaque_pthread_attr_t;
pub const __darwin_pthread_cond_t = struct__opaque_pthread_cond_t;
pub const __darwin_pthread_condattr_t = struct__opaque_pthread_condattr_t;
pub const __darwin_pthread_key_t = c_ulong;
pub const __darwin_pthread_mutex_t = struct__opaque_pthread_mutex_t;
pub const __darwin_pthread_mutexattr_t = struct__opaque_pthread_mutexattr_t;
pub const __darwin_pthread_once_t = struct__opaque_pthread_once_t;
pub const __darwin_pthread_rwlock_t = struct__opaque_pthread_rwlock_t;
pub const __darwin_pthread_rwlockattr_t = struct__opaque_pthread_rwlockattr_t;
pub const __darwin_pthread_t = [*c]struct__opaque_pthread_t;
pub const u_int8_t = u8;
pub const u_int16_t = c_ushort;
pub const u_int32_t = c_uint;
pub const u_int64_t = c_ulonglong;
pub const register_t = i64;
pub const user_addr_t = u_int64_t;
pub const user_size_t = u_int64_t;
pub const user_ssize_t = i64;
pub const user_long_t = i64;
pub const user_ulong_t = u_int64_t;
pub const user_time_t = i64;
pub const user_off_t = i64;
pub const syscall_arg_t = u_int64_t;
pub const intmax_t = c_long;
pub const uintmax_t = c_ulong;
pub const boolean_t = c_int;
pub const kern_return_t = c_int;
pub const natural_t = __darwin_natural_t;
pub const integer_t = c_int;
pub const vm_offset_t = usize;
pub const vm_size_t = usize;
pub const mach_vm_address_t = u64;
pub const mach_vm_offset_t = u64;
pub const mach_vm_size_t = u64;
pub const vm_map_offset_t = u64;
pub const vm_map_address_t = u64;
pub const vm_map_size_t = u64;
pub const vm32_offset_t = u32;
pub const vm32_address_t = u32;
pub const vm32_size_t = u32;
pub const mach_port_context_t = vm_offset_t;
pub const mach_port_name_t = natural_t;
pub const mach_port_name_array_t = [*c]mach_port_name_t;
pub const mach_port_t = __darwin_mach_port_t;
pub const mach_port_array_t = [*c]mach_port_t;
pub const mach_port_right_t = natural_t;
pub const mach_port_type_t = natural_t;
pub const mach_port_type_array_t = [*c]mach_port_type_t;
pub const mach_port_urefs_t = natural_t;
pub const mach_port_delta_t = integer_t;
pub const mach_port_seqno_t = natural_t;
pub const mach_port_mscount_t = natural_t;
pub const mach_port_msgcount_t = natural_t;
pub const mach_port_rights_t = natural_t;
pub const mach_port_srights_t = c_uint;
pub const struct_mach_port_status = extern struct {
    mps_pset: mach_port_rights_t,
    mps_seqno: mach_port_seqno_t,
    mps_mscount: mach_port_mscount_t,
    mps_qlimit: mach_port_msgcount_t,
    mps_msgcount: mach_port_msgcount_t,
    mps_sorights: mach_port_rights_t,
    mps_srights: boolean_t,
    mps_pdrequest: boolean_t,
    mps_nsrequest: boolean_t,
    mps_flags: natural_t,
};
pub const mach_port_status_t = struct_mach_port_status;
pub const struct_mach_port_limits = extern struct {
    mpl_qlimit: mach_port_msgcount_t,
};
pub const mach_port_limits_t = struct_mach_port_limits;
pub const struct_mach_port_info_ext = extern struct {
    mpie_status: mach_port_status_t,
    mpie_boost_cnt: mach_port_msgcount_t,
    reserved: [6]u32,
};
pub const mach_port_info_ext_t = struct_mach_port_info_ext;
pub const struct_mach_port_guard_info = extern struct {
    mpgi_guard: u64,
};
pub const mach_port_guard_info_t = struct_mach_port_guard_info;
pub const mach_port_info_t = [*c]integer_t;
pub const mach_port_flavor_t = c_int; // /Users/jarred/Build/zig/lib/libc/include/any-macos.12-any/mach/port.h:327:26: warning: struct demoted to opaque type - has bitfield
pub const struct_mach_port_qos = opaque {};
pub const mach_port_qos_t = struct_mach_port_qos;
pub const struct_mach_service_port_info = extern struct {
    mspi_string_name: [255]u8,
    mspi_domain_type: u8,
};
pub const mach_service_port_info_data_t = struct_mach_service_port_info;
pub const mach_service_port_info_t = [*c]struct_mach_service_port_info;
const union_unnamed_1 = extern union {
    reserved: [2]u64,
    work_interval_port: mach_port_name_t,
    service_port_info: mach_service_port_info_t,
    service_port_name: mach_port_name_t,
};
pub const struct_mach_port_options = extern struct {
    flags: u32,
    mpl: mach_port_limits_t,
    unnamed_0: union_unnamed_1,
};
pub const mach_port_options_t = struct_mach_port_options;
pub const mach_port_options_ptr_t = [*c]mach_port_options_t;
pub const kGUARD_EXC_DESTROY: c_int = 1;
pub const kGUARD_EXC_MOD_REFS: c_int = 2;
pub const kGUARD_EXC_SET_CONTEXT: c_int = 4;
pub const kGUARD_EXC_UNGUARDED: c_int = 8;
pub const kGUARD_EXC_INCORRECT_GUARD: c_int = 16;
pub const kGUARD_EXC_IMMOVABLE: c_int = 32;
pub const kGUARD_EXC_STRICT_REPLY: c_int = 64;
pub const kGUARD_EXC_MSG_FILTERED: c_int = 128;
pub const kGUARD_EXC_INVALID_RIGHT: c_int = 256;
pub const kGUARD_EXC_INVALID_NAME: c_int = 512;
pub const kGUARD_EXC_INVALID_VALUE: c_int = 1024;
pub const kGUARD_EXC_INVALID_ARGUMENT: c_int = 2048;
pub const kGUARD_EXC_RIGHT_EXISTS: c_int = 4096;
pub const kGUARD_EXC_KERN_NO_SPACE: c_int = 8192;
pub const kGUARD_EXC_KERN_FAILURE: c_int = 16384;
pub const kGUARD_EXC_KERN_RESOURCE: c_int = 32768;
pub const kGUARD_EXC_SEND_INVALID_REPLY: c_int = 65536;
pub const kGUARD_EXC_SEND_INVALID_VOUCHER: c_int = 131072;
pub const kGUARD_EXC_SEND_INVALID_RIGHT: c_int = 262144;
pub const kGUARD_EXC_RCV_INVALID_NAME: c_int = 524288;
pub const kGUARD_EXC_RCV_GUARDED_DESC: c_int = 1048576;
pub const kGUARD_EXC_MOD_REFS_NON_FATAL: c_int = 2097152;
pub const kGUARD_EXC_IMMOVABLE_NON_FATAL: c_int = 4194304;
pub const enum_mach_port_guard_exception_codes = c_uint;
pub const pointer_t = vm_offset_t;
pub const vm_address_t = vm_offset_t;
pub const addr64_t = u64;
pub const reg64_t = u32;
pub const ppnum_t = u32;
pub const vm_map_t = mach_port_t;
pub const vm_map_read_t = mach_port_t;
pub const vm_map_inspect_t = mach_port_t;
pub const vm_object_offset_t = u64;
pub const vm_object_size_t = u64;
pub const upl_t = mach_port_t;
pub const vm_named_entry_t = mach_port_t;
pub const uuid_t = __darwin_uuid_t;
pub const mach_msg_timeout_t = natural_t;
pub const mach_msg_bits_t = c_uint;
pub const mach_msg_size_t = natural_t;
pub const mach_msg_id_t = integer_t;
pub const mach_msg_priority_t = c_uint;
pub const mach_msg_type_name_t = c_uint;
pub const mach_msg_copy_options_t = c_uint;
pub const mach_msg_guard_flags_t = c_uint;
pub const mach_msg_descriptor_type_t = c_uint; // /Users/jarred/Build/zig/lib/libc/include/any-macos.12-any/mach/message.h:286:32: warning: struct demoted to opaque type - has bitfield
pub const mach_msg_type_descriptor_t = opaque {}; // /Users/jarred/Build/zig/lib/libc/include/any-macos.12-any/mach/message.h:294:32: warning: struct demoted to opaque type - has bitfield
pub const mach_msg_port_descriptor_t = opaque {}; // /Users/jarred/Build/zig/lib/libc/include/any-macos.12-any/mach/message.h:303:32: warning: struct demoted to opaque type - has bitfield
pub const mach_msg_ool_descriptor32_t = opaque {}; // /Users/jarred/Build/zig/lib/libc/include/any-macos.12-any/mach/message.h:311:32: warning: struct demoted to opaque type - has bitfield
pub const mach_msg_ool_descriptor64_t = opaque {}; // /Users/jarred/Build/zig/lib/libc/include/any-macos.12-any/mach/message.h:323:32: warning: struct demoted to opaque type - has bitfield
pub const mach_msg_ool_descriptor_t = opaque {}; // /Users/jarred/Build/zig/lib/libc/include/any-macos.12-any/mach/message.h:335:32: warning: struct demoted to opaque type - has bitfield
pub const mach_msg_ool_ports_descriptor32_t = opaque {}; // /Users/jarred/Build/zig/lib/libc/include/any-macos.12-any/mach/message.h:343:32: warning: struct demoted to opaque type - has bitfield
pub const mach_msg_ool_ports_descriptor64_t = opaque {}; // /Users/jarred/Build/zig/lib/libc/include/any-macos.12-any/mach/message.h:355:32: warning: struct demoted to opaque type - has bitfield
pub const mach_msg_ool_ports_descriptor_t = opaque {}; // /Users/jarred/Build/zig/lib/libc/include/any-macos.12-any/mach/message.h:367:32: warning: struct demoted to opaque type - has bitfield
pub const mach_msg_guarded_port_descriptor32_t = opaque {}; // /Users/jarred/Build/zig/lib/libc/include/any-macos.12-any/mach/message.h:374:32: warning: struct demoted to opaque type - has bitfield
pub const mach_msg_guarded_port_descriptor64_t = opaque {}; // /Users/jarred/Build/zig/lib/libc/include/any-macos.12-any/mach/message.h:385:32: warning: struct demoted to opaque type - has bitfield
pub const mach_msg_guarded_port_descriptor_t = opaque {};
pub const mach_msg_descriptor_t = extern union {
    port: mach_msg_port_descriptor_t,
    out_of_line: mach_msg_ool_descriptor_t,
    ool_ports: mach_msg_ool_ports_descriptor_t,
    type: mach_msg_type_descriptor_t,
    guarded_port: mach_msg_guarded_port_descriptor_t,
};
pub const mach_msg_body_t = extern struct {
    msgh_descriptor_count: mach_msg_size_t,
};
pub const mach_msg_header_t = extern struct {
    msgh_bits: mach_msg_bits_t,
    msgh_size: mach_msg_size_t,
    msgh_remote_port: mach_port_t,
    msgh_local_port: mach_port_t,
    msgh_voucher_port: mach_port_name_t,
    msgh_id: mach_msg_id_t,
};
pub const mach_msg_base_t = extern struct {
    header: mach_msg_header_t,
    body: mach_msg_body_t,
};
pub const mach_msg_trailer_type_t = c_uint;
pub const mach_msg_trailer_size_t = c_uint;
pub const mach_msg_trailer_info_t = [*c]u8;
pub const mach_msg_trailer_t = extern struct {
    msgh_trailer_type: mach_msg_trailer_type_t,
    msgh_trailer_size: mach_msg_trailer_size_t,
};
pub const mach_msg_seqno_trailer_t = extern struct {
    msgh_trailer_type: mach_msg_trailer_type_t,
    msgh_trailer_size: mach_msg_trailer_size_t,
    msgh_seqno: mach_port_seqno_t,
};
pub const security_token_t = extern struct {
    val: [2]c_uint,
};
pub const mach_msg_security_trailer_t = extern struct {
    msgh_trailer_type: mach_msg_trailer_type_t,
    msgh_trailer_size: mach_msg_trailer_size_t,
    msgh_seqno: mach_port_seqno_t,
    msgh_sender: security_token_t,
};
pub const audit_token_t = extern struct {
    val: [8]c_uint,
};
pub const mach_msg_audit_trailer_t = extern struct {
    msgh_trailer_type: mach_msg_trailer_type_t,
    msgh_trailer_size: mach_msg_trailer_size_t,
    msgh_seqno: mach_port_seqno_t,
    msgh_sender: security_token_t,
    msgh_audit: audit_token_t,
};
pub const mach_msg_context_trailer_t = extern struct {
    msgh_trailer_type: mach_msg_trailer_type_t,
    msgh_trailer_size: mach_msg_trailer_size_t,
    msgh_seqno: mach_port_seqno_t,
    msgh_sender: security_token_t,
    msgh_audit: audit_token_t,
    msgh_context: mach_port_context_t,
};
pub const msg_labels_t = extern struct {
    sender: mach_port_name_t,
};
pub const mach_msg_filter_id = c_int;
pub const mach_msg_mac_trailer_t = extern struct {
    msgh_trailer_type: mach_msg_trailer_type_t,
    msgh_trailer_size: mach_msg_trailer_size_t,
    msgh_seqno: mach_port_seqno_t,
    msgh_sender: security_token_t,
    msgh_audit: audit_token_t,
    msgh_context: mach_port_context_t,
    msgh_ad: mach_msg_filter_id,
    msgh_labels: msg_labels_t,
};
pub const mach_msg_max_trailer_t = mach_msg_mac_trailer_t;
pub const mach_msg_format_0_trailer_t = mach_msg_security_trailer_t;
pub extern const KERNEL_SECURITY_TOKEN: security_token_t;
pub extern const KERNEL_AUDIT_TOKEN: audit_token_t;
pub const mach_msg_options_t = integer_t;
pub const mach_msg_empty_send_t = extern struct {
    header: mach_msg_header_t,
};
pub const mach_msg_empty_rcv_t = extern struct {
    header: mach_msg_header_t,
    trailer: mach_msg_trailer_t,
};
pub const mach_msg_empty_t = extern union {
    send: mach_msg_empty_send_t,
    rcv: mach_msg_empty_rcv_t,
};
pub const mach_msg_type_size_t = natural_t;
pub const mach_msg_type_number_t = natural_t;
pub const mach_msg_option_t = integer_t;
pub const mach_msg_return_t = kern_return_t;
pub extern fn mach_msg_overwrite(msg: [*c]mach_msg_header_t, option: mach_msg_option_t, send_size: mach_msg_size_t, rcv_size: mach_msg_size_t, rcv_name: mach_port_name_t, timeout: mach_msg_timeout_t, notify: mach_port_name_t, rcv_msg: [*c]mach_msg_header_t, rcv_limit: mach_msg_size_t) mach_msg_return_t;
pub extern fn mach_msg(msg: [*c]mach_msg_header_t, option: mach_msg_option_t, send_size: mach_msg_size_t, rcv_size: mach_msg_size_t, rcv_name: mach_port_name_t, timeout: mach_msg_timeout_t, notify: mach_port_name_t) mach_msg_return_t;
pub extern fn mach_voucher_deallocate(voucher: mach_port_name_t) kern_return_t;
pub const struct_vm_statistics = extern struct {
    free_count: natural_t,
    active_count: natural_t,
    inactive_count: natural_t,
    wire_count: natural_t,
    zero_fill_count: natural_t,
    reactivations: natural_t,
    pageins: natural_t,
    pageouts: natural_t,
    faults: natural_t,
    cow_faults: natural_t,
    lookups: natural_t,
    hits: natural_t,
    purgeable_count: natural_t,
    purges: natural_t,
    speculative_count: natural_t,
};
pub const vm_statistics_t = [*c]struct_vm_statistics;
pub const vm_statistics_data_t = struct_vm_statistics;
pub const struct_vm_statistics64 = extern struct {
    free_count: natural_t,
    active_count: natural_t,
    inactive_count: natural_t,
    wire_count: natural_t,
    zero_fill_count: u64,
    reactivations: u64,
    pageins: u64,
    pageouts: u64,
    faults: u64,
    cow_faults: u64,
    lookups: u64,
    hits: u64,
    purges: u64,
    purgeable_count: natural_t,
    speculative_count: natural_t,
    decompressions: u64,
    compressions: u64,
    swapins: u64,
    swapouts: u64,
    compressor_page_count: natural_t,
    throttled_count: natural_t,
    external_page_count: natural_t,
    internal_page_count: natural_t,
    total_uncompressed_pages_in_compressor: u64,
};
pub const vm_statistics64_t = [*c]struct_vm_statistics64;
pub const vm_statistics64_data_t = struct_vm_statistics64;
pub extern fn vm_stats(info: ?*anyopaque, count: [*c]c_uint) kern_return_t;
pub const struct_vm_extmod_statistics = extern struct {
    task_for_pid_count: i64,
    task_for_pid_caller_count: i64,
    thread_creation_count: i64,
    thread_creation_caller_count: i64,
    thread_set_state_count: i64,
    thread_set_state_caller_count: i64,
};
pub const vm_extmod_statistics_t = [*c]struct_vm_extmod_statistics;
pub const vm_extmod_statistics_data_t = struct_vm_extmod_statistics;
pub const struct_vm_purgeable_stat = extern struct {
    count: u64,
    size: u64,
};
pub const vm_purgeable_stat_t = struct_vm_purgeable_stat;
pub const struct_vm_purgeable_info = extern struct {
    fifo_data: [8]vm_purgeable_stat_t,
    obsolete_data: vm_purgeable_stat_t,
    lifo_data: [8]vm_purgeable_stat_t,
};
pub const vm_purgeable_info_t = [*c]struct_vm_purgeable_info;
pub const kGUARD_EXC_DEALLOC_GAP: c_int = 1;
pub const enum_virtual_memory_guard_exception_codes = c_uint;
pub const cpu_type_t = integer_t;
pub const cpu_subtype_t = integer_t;
pub const cpu_threadtype_t = integer_t;
pub const struct_time_value = extern struct {
    seconds: integer_t,
    microseconds: integer_t,
};
pub const time_value_t = struct_time_value;
pub const host_info_t = [*c]integer_t;
pub const host_info64_t = [*c]integer_t;
pub const host_info_data_t = [1024]integer_t;
pub const kernel_version_t = [512]u8;
pub const kernel_boot_info_t = [4096]u8;
pub const host_flavor_t = integer_t;
pub const struct_host_can_has_debugger_info = extern struct {
    can_has_debugger: boolean_t,
};
pub const host_can_has_debugger_info_data_t = struct_host_can_has_debugger_info;
pub const host_can_has_debugger_info_t = [*c]struct_host_can_has_debugger_info;
pub const struct_host_basic_info = extern struct {
    max_cpus: integer_t,
    avail_cpus: integer_t,
    memory_size: natural_t,
    cpu_type: cpu_type_t,
    cpu_subtype: cpu_subtype_t,
    cpu_threadtype: cpu_threadtype_t,
    physical_cpu: integer_t,
    physical_cpu_max: integer_t,
    logical_cpu: integer_t,
    logical_cpu_max: integer_t,
    max_mem: u64,
};
pub const host_basic_info_data_t = struct_host_basic_info;
pub const host_basic_info_t = [*c]struct_host_basic_info;
pub const struct_host_sched_info = extern struct {
    min_timeout: integer_t,
    min_quantum: integer_t,
};
pub const host_sched_info_data_t = struct_host_sched_info;
pub const host_sched_info_t = [*c]struct_host_sched_info;
pub const struct_kernel_resource_sizes = extern struct {
    task: natural_t,
    thread: natural_t,
    port: natural_t,
    memory_region: natural_t,
    memory_object: natural_t,
};
pub const kernel_resource_sizes_data_t = struct_kernel_resource_sizes;
pub const kernel_resource_sizes_t = [*c]struct_kernel_resource_sizes;
pub const struct_host_priority_info = extern struct {
    kernel_priority: integer_t,
    system_priority: integer_t,
    server_priority: integer_t,
    user_priority: integer_t,
    depress_priority: integer_t,
    idle_priority: integer_t,
    minimum_priority: integer_t,
    maximum_priority: integer_t,
};
pub const host_priority_info_data_t = struct_host_priority_info;
pub const host_priority_info_t = [*c]struct_host_priority_info;
pub const struct_host_load_info = extern struct {
    avenrun: [3]integer_t,
    mach_factor: [3]integer_t,
};
pub const host_load_info_data_t = struct_host_load_info;
pub const host_load_info_t = [*c]struct_host_load_info;
pub const host_purgable_info_data_t = struct_vm_purgeable_info;
pub const host_purgable_info_t = [*c]struct_vm_purgeable_info;
pub const struct_host_cpu_load_info = extern struct {
    cpu_ticks: [4]natural_t,
};
pub const host_cpu_load_info_data_t = struct_host_cpu_load_info;
pub const host_cpu_load_info_t = [*c]struct_host_cpu_load_info;
pub const struct_host_preferred_user_arch = extern struct {
    cpu_type: cpu_type_t,
    cpu_subtype: cpu_subtype_t,
};
pub const host_preferred_user_arch_data_t = struct_host_preferred_user_arch;
pub const host_preferred_user_arch_t = [*c]struct_host_preferred_user_arch;
pub const vm_prot_t = c_int;
pub const vm_sync_t = c_uint;
pub const memory_object_offset_t = c_ulonglong;
pub const memory_object_size_t = c_ulonglong;
pub const memory_object_cluster_size_t = natural_t;
pub const memory_object_fault_info_t = [*c]natural_t;
pub const vm_object_id_t = c_ulonglong;
pub const memory_object_t = mach_port_t;
pub const memory_object_control_t = mach_port_t;
pub const memory_object_array_t = [*c]memory_object_t;
pub const memory_object_name_t = mach_port_t;
pub const memory_object_default_t = mach_port_t;
pub const memory_object_copy_strategy_t = c_int;
pub const memory_object_return_t = c_int;
pub const memory_object_info_t = [*c]c_int;
pub const memory_object_flavor_t = c_int;
pub const memory_object_info_data_t = [1024]c_int;
pub const struct_memory_object_perf_info = extern struct {
    cluster_size: memory_object_cluster_size_t,
    may_cache: boolean_t,
};
pub const struct_memory_object_attr_info = extern struct {
    copy_strategy: memory_object_copy_strategy_t,
    cluster_size: memory_object_cluster_size_t,
    may_cache_object: boolean_t,
    temporary: boolean_t,
};
pub const struct_memory_object_behave_info = extern struct {
    copy_strategy: memory_object_copy_strategy_t,
    temporary: boolean_t,
    invalidate: boolean_t,
    silent_overwrite: boolean_t,
    advisory_pageout: boolean_t,
};
pub const memory_object_behave_info_t = [*c]struct_memory_object_behave_info;
pub const memory_object_behave_info_data_t = struct_memory_object_behave_info;
pub const memory_object_perf_info_t = [*c]struct_memory_object_perf_info;
pub const memory_object_perf_info_data_t = struct_memory_object_perf_info;
pub const memory_object_attr_info_t = [*c]struct_memory_object_attr_info;
pub const memory_object_attr_info_data_t = struct_memory_object_attr_info;
pub const struct___darwin_arm_exception_state = extern struct {
    __exception: __uint32_t,
    __fsr: __uint32_t,
    __far: __uint32_t,
};
pub const struct___darwin_arm_exception_state64 = extern struct {
    __far: __uint64_t,
    __esr: __uint32_t,
    __exception: __uint32_t,
};
pub const struct___darwin_arm_thread_state = extern struct {
    __r: [13]__uint32_t,
    __sp: __uint32_t,
    __lr: __uint32_t,
    __pc: __uint32_t,
    __cpsr: __uint32_t,
};
pub const struct___darwin_arm_thread_state64 = extern struct {
    __x: [29]__uint64_t,
    __fp: __uint64_t,
    __lr: __uint64_t,
    __sp: __uint64_t,
    __pc: __uint64_t,
    __cpsr: __uint32_t,
    __pad: __uint32_t,
};
pub const struct___darwin_arm_vfp_state = extern struct {
    __r: [64]__uint32_t,
    __fpscr: __uint32_t,
};
pub const __uint128_t = u128;
pub const struct___darwin_arm_neon_state64 = extern struct {
    __v: [32]__uint128_t,
    __fpsr: __uint32_t,
    __fpcr: __uint32_t,
};
pub const struct___darwin_arm_neon_state = extern struct {
    __v: [16]__uint128_t,
    __fpsr: __uint32_t,
    __fpcr: __uint32_t,
};
pub const struct___arm_pagein_state = extern struct {
    __pagein_error: c_int,
};
pub const struct___arm_legacy_debug_state = extern struct {
    __bvr: [16]__uint32_t,
    __bcr: [16]__uint32_t,
    __wvr: [16]__uint32_t,
    __wcr: [16]__uint32_t,
};
pub const struct___darwin_arm_debug_state32 = extern struct {
    __bvr: [16]__uint32_t,
    __bcr: [16]__uint32_t,
    __wvr: [16]__uint32_t,
    __wcr: [16]__uint32_t,
    __mdscr_el1: __uint64_t,
};
pub const struct___darwin_arm_debug_state64 = extern struct {
    __bvr: [16]__uint64_t,
    __bcr: [16]__uint64_t,
    __wvr: [16]__uint64_t,
    __wcr: [16]__uint64_t,
    __mdscr_el1: __uint64_t,
};
pub const struct___darwin_arm_cpmu_state64 = extern struct {
    __ctrs: [16]__uint64_t,
};
pub const struct_arm_state_hdr = extern struct {
    flavor: u32,
    count: u32,
};
pub const arm_state_hdr_t = struct_arm_state_hdr;
pub const arm_thread_state_t = struct___darwin_arm_thread_state;
pub const arm_thread_state32_t = struct___darwin_arm_thread_state;
pub const arm_thread_state64_t = struct___darwin_arm_thread_state64;
const union_unnamed_2 = extern union {
    ts_32: arm_thread_state32_t,
    ts_64: arm_thread_state64_t,
};
pub const struct_arm_unified_thread_state = extern struct {
    ash: arm_state_hdr_t,
    uts: union_unnamed_2,
};
pub const arm_unified_thread_state_t = struct_arm_unified_thread_state;
pub const arm_vfp_state_t = struct___darwin_arm_vfp_state;
pub const arm_neon_state_t = struct___darwin_arm_neon_state;
pub const arm_neon_state32_t = struct___darwin_arm_neon_state;
pub const arm_neon_state64_t = struct___darwin_arm_neon_state64;
pub const arm_exception_state_t = struct___darwin_arm_exception_state;
pub const arm_exception_state32_t = struct___darwin_arm_exception_state;
pub const arm_exception_state64_t = struct___darwin_arm_exception_state64;
pub const arm_debug_state32_t = struct___darwin_arm_debug_state32;
pub const arm_debug_state64_t = struct___darwin_arm_debug_state64;
pub const arm_pagein_state_t = struct___arm_pagein_state;
pub const arm_debug_state_t = struct___arm_legacy_debug_state;
pub const thread_state_t = [*c]natural_t;
pub const thread_state_data_t = [1296]natural_t;
pub const thread_state_flavor_t = c_int;
pub const thread_state_flavor_array_t = [*c]thread_state_flavor_t;
pub const struct_ipc_info_space = extern struct {
    iis_genno_mask: natural_t,
    iis_table_size: natural_t,
    iis_table_next: natural_t,
    iis_tree_size: natural_t,
    iis_tree_small: natural_t,
    iis_tree_hash: natural_t,
};
pub const ipc_info_space_t = struct_ipc_info_space;
pub const struct_ipc_info_space_basic = extern struct {
    iisb_genno_mask: natural_t,
    iisb_table_size: natural_t,
    iisb_table_next: natural_t,
    iisb_table_inuse: natural_t,
    iisb_reserved: [2]natural_t,
};
pub const ipc_info_space_basic_t = struct_ipc_info_space_basic;
pub const struct_ipc_info_name = extern struct {
    iin_name: mach_port_name_t,
    iin_collision: integer_t,
    iin_type: mach_port_type_t,
    iin_urefs: mach_port_urefs_t,
    iin_object: natural_t,
    iin_next: natural_t,
    iin_hash: natural_t,
};
pub const ipc_info_name_t = struct_ipc_info_name;
pub const ipc_info_name_array_t = [*c]ipc_info_name_t;
pub const struct_ipc_info_tree_name = extern struct {
    iitn_name: ipc_info_name_t,
    iitn_lchild: mach_port_name_t,
    iitn_rchild: mach_port_name_t,
};
pub const ipc_info_tree_name_t = struct_ipc_info_tree_name;
pub const ipc_info_tree_name_array_t = [*c]ipc_info_tree_name_t;
pub const struct_ipc_info_port = extern struct {
    iip_port_object: natural_t,
    iip_receiver_object: natural_t,
};
pub const ipc_info_port_t = struct_ipc_info_port;
pub const exception_handler_info_array_t = [*c]ipc_info_port_t;
pub const exception_type_t = c_int;
pub const exception_data_type_t = integer_t;
pub const mach_exception_data_type_t = i64;
pub const exception_behavior_t = c_int;
pub const exception_data_t = [*c]exception_data_type_t;
pub const mach_exception_data_t = [*c]mach_exception_data_type_t;
pub const exception_mask_t = c_uint;
pub const exception_mask_array_t = [*c]exception_mask_t;
pub const exception_behavior_array_t = [*c]exception_behavior_t;
pub const exception_flavor_array_t = [*c]thread_state_flavor_t;
pub const exception_port_array_t = [*c]mach_port_t;
pub const exception_port_info_array_t = [*c]ipc_info_port_t;
pub const mach_exception_code_t = mach_exception_data_type_t;
pub const mach_exception_subcode_t = mach_exception_data_type_t;
pub const mach_voucher_t = mach_port_t;
pub const mach_voucher_name_t = mach_port_name_t;
pub const mach_voucher_name_array_t = [*c]mach_voucher_name_t;
pub const ipc_voucher_t = mach_voucher_t;
pub const mach_voucher_selector_t = u32;
pub const mach_voucher_attr_key_t = u32;
pub const mach_voucher_attr_key_array_t = [*c]mach_voucher_attr_key_t;
pub const mach_voucher_attr_content_t = [*c]u8;
pub const mach_voucher_attr_content_size_t = u32;
pub const mach_voucher_attr_command_t = u32;
pub const mach_voucher_attr_recipe_command_t = u32;
pub const mach_voucher_attr_recipe_command_array_t = [*c]mach_voucher_attr_recipe_command_t;
pub const struct_mach_voucher_attr_recipe_data = extern struct {
    key: mach_voucher_attr_key_t align(1),
    command: mach_voucher_attr_recipe_command_t,
    previous_voucher: mach_voucher_name_t,
    content_size: mach_voucher_attr_content_size_t,
    pub fn content(self: anytype) @import("std").zig.c_translation.FlexibleArrayType(@TypeOf(self), u8) {
        const Intermediate = @import("std").zig.c_translation.FlexibleArrayType(@TypeOf(self), u8);
        const ReturnType = @import("std").zig.c_translation.FlexibleArrayType(@TypeOf(self), u8);
        return @ptrCast(ReturnType, @alignCast(@alignOf(u8), @ptrCast(Intermediate, self) + 16));
    }
};
pub const mach_voucher_attr_recipe_data_t = struct_mach_voucher_attr_recipe_data;
pub const mach_voucher_attr_recipe_t = [*c]mach_voucher_attr_recipe_data_t;
pub const mach_voucher_attr_recipe_size_t = mach_msg_type_number_t;
pub const mach_voucher_attr_raw_recipe_t = [*c]u8;
pub const mach_voucher_attr_raw_recipe_array_t = mach_voucher_attr_raw_recipe_t;
pub const mach_voucher_attr_raw_recipe_size_t = mach_msg_type_number_t;
pub const mach_voucher_attr_raw_recipe_array_size_t = mach_msg_type_number_t;
pub const mach_voucher_attr_manager_t = mach_port_t;
pub const mach_voucher_attr_control_t = mach_port_t;
pub const ipc_voucher_attr_manager_t = mach_port_t;
pub const ipc_voucher_attr_control_t = mach_port_t;
pub const mach_voucher_attr_value_handle_t = u64;
pub const mach_voucher_attr_value_handle_array_t = [*c]mach_voucher_attr_value_handle_t;
pub const mach_voucher_attr_value_handle_array_size_t = mach_msg_type_number_t;
pub const mach_voucher_attr_value_reference_t = u32;
pub const mach_voucher_attr_value_flags_t = u32;
pub const mach_voucher_attr_control_flags_t = u32;
pub const mach_voucher_attr_importance_refs = u32;
pub const struct_processor_cpu_stat = extern struct {
    irq_ex_cnt: u32,
    ipi_cnt: u32,
    timer_cnt: u32,
    undef_ex_cnt: u32,
    unaligned_cnt: u32,
    vfp_cnt: u32,
    vfp_shortv_cnt: u32,
    data_ex_cnt: u32,
    instr_ex_cnt: u32,
};
pub const processor_cpu_stat_data_t = struct_processor_cpu_stat;
pub const processor_cpu_stat_t = [*c]struct_processor_cpu_stat;
pub const struct_processor_cpu_stat64 = packed struct {
    irq_ex_cnt: u64,
    ipi_cnt: u64,
    timer_cnt: u64,
    undef_ex_cnt: u64,
    unaligned_cnt: u64,
    vfp_cnt: u64,
    vfp_shortv_cnt: u64,
    data_ex_cnt: u64,
    instr_ex_cnt: u64,
    pmi_cnt: u64,
};
pub const processor_cpu_stat64_data_t = struct_processor_cpu_stat64;
pub const processor_cpu_stat64_t = [*c]struct_processor_cpu_stat64;
pub const processor_info_t = [*c]integer_t;
pub const processor_info_array_t = [*c]integer_t;
pub const processor_info_data_t = [1024]integer_t;
pub const processor_set_info_t = [*c]integer_t;
pub const processor_set_info_data_t = [1024]integer_t;
pub const processor_flavor_t = c_int;
pub const struct_processor_basic_info = extern struct {
    cpu_type: cpu_type_t,
    cpu_subtype: cpu_subtype_t,
    running: boolean_t,
    slot_num: c_int,
    is_master: boolean_t,
};
pub const processor_basic_info_data_t = struct_processor_basic_info;
pub const processor_basic_info_t = [*c]struct_processor_basic_info;
pub const struct_processor_cpu_load_info = extern struct {
    cpu_ticks: [4]c_uint,
};
pub const processor_cpu_load_info_data_t = struct_processor_cpu_load_info;
pub const processor_cpu_load_info_t = [*c]struct_processor_cpu_load_info;
pub const processor_set_flavor_t = c_int;
pub const struct_processor_set_basic_info = extern struct {
    processor_count: c_int,
    default_policy: c_int,
};
pub const processor_set_basic_info_data_t = struct_processor_set_basic_info;
pub const processor_set_basic_info_t = [*c]struct_processor_set_basic_info;
pub const struct_processor_set_load_info = extern struct {
    task_count: c_int,
    thread_count: c_int,
    load_average: integer_t,
    mach_factor: integer_t,
};
pub const processor_set_load_info_data_t = struct_processor_set_load_info;
pub const processor_set_load_info_t = [*c]struct_processor_set_load_info;
pub const policy_t = c_int;
pub const policy_info_t = [*c]integer_t;
pub const policy_base_t = [*c]integer_t;
pub const policy_limit_t = [*c]integer_t;
pub const struct_policy_timeshare_base = extern struct {
    base_priority: integer_t,
};
pub const struct_policy_timeshare_limit = extern struct {
    max_priority: integer_t,
};
pub const struct_policy_timeshare_info = extern struct {
    max_priority: integer_t,
    base_priority: integer_t,
    cur_priority: integer_t,
    depressed: boolean_t,
    depress_priority: integer_t,
};
pub const policy_timeshare_base_t = [*c]struct_policy_timeshare_base;
pub const policy_timeshare_limit_t = [*c]struct_policy_timeshare_limit;
pub const policy_timeshare_info_t = [*c]struct_policy_timeshare_info;
pub const policy_timeshare_base_data_t = struct_policy_timeshare_base;
pub const policy_timeshare_limit_data_t = struct_policy_timeshare_limit;
pub const policy_timeshare_info_data_t = struct_policy_timeshare_info;
pub const struct_policy_rr_base = extern struct {
    base_priority: integer_t,
    quantum: integer_t,
};
pub const struct_policy_rr_limit = extern struct {
    max_priority: integer_t,
};
pub const struct_policy_rr_info = extern struct {
    max_priority: integer_t,
    base_priority: integer_t,
    quantum: integer_t,
    depressed: boolean_t,
    depress_priority: integer_t,
};
pub const policy_rr_base_t = [*c]struct_policy_rr_base;
pub const policy_rr_limit_t = [*c]struct_policy_rr_limit;
pub const policy_rr_info_t = [*c]struct_policy_rr_info;
pub const policy_rr_base_data_t = struct_policy_rr_base;
pub const policy_rr_limit_data_t = struct_policy_rr_limit;
pub const policy_rr_info_data_t = struct_policy_rr_info;
pub const struct_policy_fifo_base = extern struct {
    base_priority: integer_t,
};
pub const struct_policy_fifo_limit = extern struct {
    max_priority: integer_t,
};
pub const struct_policy_fifo_info = extern struct {
    max_priority: integer_t,
    base_priority: integer_t,
    depressed: boolean_t,
    depress_priority: integer_t,
};
pub const policy_fifo_base_t = [*c]struct_policy_fifo_base;
pub const policy_fifo_limit_t = [*c]struct_policy_fifo_limit;
pub const policy_fifo_info_t = [*c]struct_policy_fifo_info;
pub const policy_fifo_base_data_t = struct_policy_fifo_base;
pub const policy_fifo_limit_data_t = struct_policy_fifo_limit;
pub const policy_fifo_info_data_t = struct_policy_fifo_info;
pub const struct_policy_bases = extern struct {
    ts: policy_timeshare_base_data_t,
    rr: policy_rr_base_data_t,
    fifo: policy_fifo_base_data_t,
};
pub const struct_policy_limits = extern struct {
    ts: policy_timeshare_limit_data_t,
    rr: policy_rr_limit_data_t,
    fifo: policy_fifo_limit_data_t,
};
pub const struct_policy_infos = extern struct {
    ts: policy_timeshare_info_data_t,
    rr: policy_rr_info_data_t,
    fifo: policy_fifo_info_data_t,
};
pub const policy_base_data_t = struct_policy_bases;
pub const policy_limit_data_t = struct_policy_limits;
pub const policy_info_data_t = struct_policy_infos;
pub const task_flavor_t = natural_t;
pub const task_info_t = [*c]integer_t;
pub const task_info_data_t = [1024]integer_t;
pub const struct_task_basic_info_32 = extern struct {
    suspend_count: integer_t,
    virtual_size: natural_t,
    resident_size: natural_t,
    user_time: time_value_t,
    system_time: time_value_t,
    policy: policy_t,
};
pub const task_basic_info_32_data_t = struct_task_basic_info_32;
pub const task_basic_info_32_t = [*c]struct_task_basic_info_32;
pub const struct_task_basic_info_64 = extern struct {
    suspend_count: integer_t,
    virtual_size: mach_vm_size_t,
    resident_size: mach_vm_size_t,
    user_time: time_value_t,
    system_time: time_value_t,
    policy: policy_t,
};
pub const task_basic_info_64_data_t = struct_task_basic_info_64;
pub const task_basic_info_64_t = [*c]struct_task_basic_info_64;
pub const struct_task_basic_info = extern struct {
    suspend_count: integer_t,
    virtual_size: vm_size_t,
    resident_size: vm_size_t,
    user_time: time_value_t,
    system_time: time_value_t,
    policy: policy_t,
};
pub const task_basic_info_data_t = struct_task_basic_info;
pub const task_basic_info_t = [*c]struct_task_basic_info;
pub const struct_task_events_info = extern struct {
    faults: integer_t,
    pageins: integer_t,
    cow_faults: integer_t,
    messages_sent: integer_t,
    messages_received: integer_t,
    syscalls_mach: integer_t,
    syscalls_unix: integer_t,
    csw: integer_t,
};
pub const task_events_info_data_t = struct_task_events_info;
pub const task_events_info_t = [*c]struct_task_events_info;
pub const struct_task_thread_times_info = extern struct {
    user_time: time_value_t,
    system_time: time_value_t,
};
pub const task_thread_times_info_data_t = struct_task_thread_times_info;
pub const task_thread_times_info_t = [*c]struct_task_thread_times_info;
pub const struct_task_absolutetime_info = extern struct {
    total_user: u64,
    total_system: u64,
    threads_user: u64,
    threads_system: u64,
};
pub const task_absolutetime_info_data_t = struct_task_absolutetime_info;
pub const task_absolutetime_info_t = [*c]struct_task_absolutetime_info;
pub const struct_task_kernelmemory_info = extern struct {
    total_palloc: u64,
    total_pfree: u64,
    total_salloc: u64,
    total_sfree: u64,
};
pub const task_kernelmemory_info_data_t = struct_task_kernelmemory_info;
pub const task_kernelmemory_info_t = [*c]struct_task_kernelmemory_info;
pub const struct_task_affinity_tag_info = extern struct {
    set_count: integer_t,
    min: integer_t,
    max: integer_t,
    task_count: integer_t,
};
pub const task_affinity_tag_info_data_t = struct_task_affinity_tag_info;
pub const task_affinity_tag_info_t = [*c]struct_task_affinity_tag_info;
pub const struct_task_dyld_info = extern struct {
    all_image_info_addr: mach_vm_address_t,
    all_image_info_size: mach_vm_size_t,
    all_image_info_format: integer_t,
};
pub const task_dyld_info_data_t = struct_task_dyld_info;
pub const task_dyld_info_t = [*c]struct_task_dyld_info;
pub const struct_task_basic_info_64_2 = extern struct {
    suspend_count: integer_t,
    virtual_size: mach_vm_size_t,
    resident_size: mach_vm_size_t,
    user_time: time_value_t,
    system_time: time_value_t,
    policy: policy_t,
};
pub const task_basic_info_64_2_data_t = struct_task_basic_info_64_2;
pub const task_basic_info_64_2_t = [*c]struct_task_basic_info_64_2;
pub const struct_task_extmod_info = extern struct {
    task_uuid: [16]u8,
    extmod_statistics: vm_extmod_statistics_data_t,
};
pub const task_extmod_info_data_t = struct_task_extmod_info;
pub const task_extmod_info_t = [*c]struct_task_extmod_info;
pub const struct_mach_task_basic_info = extern struct {
    virtual_size: mach_vm_size_t,
    resident_size: mach_vm_size_t,
    resident_size_max: mach_vm_size_t,
    user_time: time_value_t,
    system_time: time_value_t,
    policy: policy_t,
    suspend_count: integer_t,
};
pub const mach_task_basic_info_data_t = struct_mach_task_basic_info;
pub const mach_task_basic_info_t = [*c]struct_mach_task_basic_info;
pub const struct_task_power_info = extern struct {
    total_user: u64,
    total_system: u64,
    task_interrupt_wakeups: u64,
    task_platform_idle_wakeups: u64,
    task_timer_wakeups_bin_1: u64,
    task_timer_wakeups_bin_2: u64,
};
pub const task_power_info_data_t = struct_task_power_info;
pub const task_power_info_t = [*c]struct_task_power_info;
pub const struct_task_vm_info = extern struct {
    virtual_size: mach_vm_size_t,
    region_count: integer_t,
    page_size: integer_t,
    resident_size: mach_vm_size_t,
    resident_size_peak: mach_vm_size_t,
    device: mach_vm_size_t,
    device_peak: mach_vm_size_t,
    internal: mach_vm_size_t,
    internal_peak: mach_vm_size_t,
    external: mach_vm_size_t,
    external_peak: mach_vm_size_t,
    reusable: mach_vm_size_t,
    reusable_peak: mach_vm_size_t,
    purgeable_volatile_pmap: mach_vm_size_t,
    purgeable_volatile_resident: mach_vm_size_t,
    purgeable_volatile_virtual: mach_vm_size_t,
    compressed: mach_vm_size_t,
    compressed_peak: mach_vm_size_t,
    compressed_lifetime: mach_vm_size_t,
    phys_footprint: mach_vm_size_t,
    min_address: mach_vm_address_t,
    max_address: mach_vm_address_t,
    ledger_phys_footprint_peak: i64,
    ledger_purgeable_nonvolatile: i64,
    ledger_purgeable_novolatile_compressed: i64,
    ledger_purgeable_volatile: i64,
    ledger_purgeable_volatile_compressed: i64,
    ledger_tag_network_nonvolatile: i64,
    ledger_tag_network_nonvolatile_compressed: i64,
    ledger_tag_network_volatile: i64,
    ledger_tag_network_volatile_compressed: i64,
    ledger_tag_media_footprint: i64,
    ledger_tag_media_footprint_compressed: i64,
    ledger_tag_media_nofootprint: i64,
    ledger_tag_media_nofootprint_compressed: i64,
    ledger_tag_graphics_footprint: i64,
    ledger_tag_graphics_footprint_compressed: i64,
    ledger_tag_graphics_nofootprint: i64,
    ledger_tag_graphics_nofootprint_compressed: i64,
    ledger_tag_neural_footprint: i64,
    ledger_tag_neural_footprint_compressed: i64,
    ledger_tag_neural_nofootprint: i64,
    ledger_tag_neural_nofootprint_compressed: i64,
    limit_bytes_remaining: u64,
    decompressions: integer_t,
};
pub const task_vm_info_data_t = struct_task_vm_info;
pub const task_vm_info_t = [*c]struct_task_vm_info;
pub const task_purgable_info_t = struct_vm_purgeable_info;
pub const struct_task_trace_memory_info = extern struct {
    user_memory_address: u64,
    buffer_size: u64,
    mailbox_array_size: u64,
};
pub const task_trace_memory_info_data_t = struct_task_trace_memory_info;
pub const task_trace_memory_info_t = [*c]struct_task_trace_memory_info;
pub const struct_task_wait_state_info = extern struct {
    total_wait_state_time: u64,
    total_wait_sfi_state_time: u64,
    _reserved: [4]u32,
};
pub const task_wait_state_info_data_t = struct_task_wait_state_info;
pub const task_wait_state_info_t = [*c]struct_task_wait_state_info;
pub const gpu_energy_data = extern struct {
    task_gpu_utilisation: u64,
    task_gpu_stat_reserved0: u64,
    task_gpu_stat_reserved1: u64,
    task_gpu_stat_reserved2: u64,
};
pub const gpu_energy_data_t = [*c]gpu_energy_data;
pub const struct_task_power_info_v2 = extern struct {
    cpu_energy: task_power_info_data_t,
    gpu_energy: gpu_energy_data,
    task_energy: u64,
    task_ptime: u64,
    task_pset_switches: u64,
};
pub const task_power_info_v2_data_t = struct_task_power_info_v2;
pub const task_power_info_v2_t = [*c]struct_task_power_info_v2;
pub const struct_task_flags_info = extern struct {
    flags: u32,
};
pub const task_flags_info_data_t = struct_task_flags_info;
pub const task_flags_info_t = [*c]struct_task_flags_info;
pub const task_exc_guard_behavior_t = u32;
pub const task_corpse_forking_behavior_t = u32;
pub const task_inspect_flavor_t = natural_t;
pub const TASK_INSPECT_BASIC_COUNTS: c_int = 1;
pub const enum_task_inspect_flavor = c_uint;
pub const struct_task_inspect_basic_counts = extern struct {
    instructions: u64,
    cycles: u64,
};
pub const task_inspect_basic_counts_data_t = struct_task_inspect_basic_counts;
pub const task_inspect_basic_counts_t = [*c]struct_task_inspect_basic_counts;
pub const task_inspect_info_t = [*c]integer_t;
pub const task_policy_flavor_t = natural_t;
pub const task_policy_t = [*c]integer_t;
pub const TASK_RENICED: c_int = -1;
pub const TASK_UNSPECIFIED: c_int = 0;
pub const TASK_FOREGROUND_APPLICATION: c_int = 1;
pub const TASK_BACKGROUND_APPLICATION: c_int = 2;
pub const TASK_CONTROL_APPLICATION: c_int = 3;
pub const TASK_GRAPHICS_SERVER: c_int = 4;
pub const TASK_THROTTLE_APPLICATION: c_int = 5;
pub const TASK_NONUI_APPLICATION: c_int = 6;
pub const TASK_DEFAULT_APPLICATION: c_int = 7;
pub const TASK_DARWINBG_APPLICATION: c_int = 8;
pub const enum_task_role = c_int;
pub const task_role_t = enum_task_role;
pub const struct_task_category_policy = extern struct {
    role: task_role_t,
};
pub const task_category_policy_data_t = struct_task_category_policy;
pub const task_category_policy_t = [*c]struct_task_category_policy;
pub const LATENCY_QOS_TIER_UNSPECIFIED: c_int = 0;
pub const LATENCY_QOS_TIER_0: c_int = 16711681;
pub const LATENCY_QOS_TIER_1: c_int = 16711682;
pub const LATENCY_QOS_TIER_2: c_int = 16711683;
pub const LATENCY_QOS_TIER_3: c_int = 16711684;
pub const LATENCY_QOS_TIER_4: c_int = 16711685;
pub const LATENCY_QOS_TIER_5: c_int = 16711686;
pub const enum_task_latency_qos = c_uint;
pub const task_latency_qos_t = integer_t;
pub const THROUGHPUT_QOS_TIER_UNSPECIFIED: c_int = 0;
pub const THROUGHPUT_QOS_TIER_0: c_int = 16646145;
pub const THROUGHPUT_QOS_TIER_1: c_int = 16646146;
pub const THROUGHPUT_QOS_TIER_2: c_int = 16646147;
pub const THROUGHPUT_QOS_TIER_3: c_int = 16646148;
pub const THROUGHPUT_QOS_TIER_4: c_int = 16646149;
pub const THROUGHPUT_QOS_TIER_5: c_int = 16646150;
pub const enum_task_throughput_qos = c_uint;
pub const task_throughput_qos_t = integer_t;
pub const struct_task_qos_policy = extern struct {
    task_latency_qos_tier: task_latency_qos_t,
    task_throughput_qos_tier: task_throughput_qos_t,
};
pub const task_qos_policy_t = [*c]struct_task_qos_policy;
pub const task_special_port_t = c_int;
pub const thread_flavor_t = natural_t;
pub const thread_info_t = [*c]integer_t;
pub const thread_info_data_t = [32]integer_t;
pub const struct_thread_basic_info = extern struct {
    user_time: time_value_t,
    system_time: time_value_t,
    cpu_usage: integer_t,
    policy: policy_t,
    run_state: integer_t,
    flags: integer_t,
    suspend_count: integer_t,
    sleep_time: integer_t,
};
pub const thread_basic_info_data_t = struct_thread_basic_info;
pub const thread_basic_info_t = [*c]struct_thread_basic_info;
pub const struct_thread_identifier_info = extern struct {
    thread_id: u64,
    thread_handle: u64,
    dispatch_qaddr: u64,
};
pub const thread_identifier_info_data_t = struct_thread_identifier_info;
pub const thread_identifier_info_t = [*c]struct_thread_identifier_info;
pub const struct_thread_extended_info = extern struct {
    pth_user_time: u64,
    pth_system_time: u64,
    pth_cpu_usage: i32,
    pth_policy: i32,
    pth_run_state: i32,
    pth_flags: i32,
    pth_sleep_time: i32,
    pth_curpri: i32,
    pth_priority: i32,
    pth_maxpriority: i32,
    pth_name: [64]u8,
};
pub const thread_extended_info_data_t = struct_thread_extended_info;
pub const thread_extended_info_t = [*c]struct_thread_extended_info;
pub const struct_io_stat_entry = extern struct {
    count: u64,
    size: u64,
};
pub const struct_io_stat_info = extern struct {
    disk_reads: struct_io_stat_entry,
    io_priority: [4]struct_io_stat_entry,
    paging: struct_io_stat_entry,
    metadata: struct_io_stat_entry,
    total_io: struct_io_stat_entry,
};
pub const io_stat_info_t = [*c]struct_io_stat_info;
pub const thread_policy_flavor_t = natural_t;
pub const thread_policy_t = [*c]integer_t;
pub const struct_thread_standard_policy = extern struct {
    no_data: natural_t,
};
pub const thread_standard_policy_data_t = struct_thread_standard_policy;
pub const thread_standard_policy_t = [*c]struct_thread_standard_policy;
pub const struct_thread_extended_policy = extern struct {
    timeshare: boolean_t,
};
pub const thread_extended_policy_data_t = struct_thread_extended_policy;
pub const thread_extended_policy_t = [*c]struct_thread_extended_policy;
pub const struct_thread_time_constraint_policy = extern struct {
    period: u32,
    computation: u32,
    constraint: u32,
    preemptible: boolean_t,
};
pub const thread_time_constraint_policy_data_t = struct_thread_time_constraint_policy;
pub const thread_time_constraint_policy_t = [*c]struct_thread_time_constraint_policy;
pub const struct_thread_precedence_policy = extern struct {
    importance: integer_t,
};
pub const thread_precedence_policy_data_t = struct_thread_precedence_policy;
pub const thread_precedence_policy_t = [*c]struct_thread_precedence_policy;
pub const struct_thread_affinity_policy = extern struct {
    affinity_tag: integer_t,
};
pub const thread_affinity_policy_data_t = struct_thread_affinity_policy;
pub const thread_affinity_policy_t = [*c]struct_thread_affinity_policy;
pub const struct_thread_background_policy = extern struct {
    priority: integer_t,
};
pub const thread_background_policy_data_t = struct_thread_background_policy;
pub const thread_background_policy_t = [*c]struct_thread_background_policy;
pub const thread_latency_qos_t = integer_t;
pub const struct_thread_latency_qos_policy = extern struct {
    thread_latency_qos_tier: thread_latency_qos_t,
};
pub const thread_latency_qos_policy_data_t = struct_thread_latency_qos_policy;
pub const thread_latency_qos_policy_t = [*c]struct_thread_latency_qos_policy;
pub const thread_throughput_qos_t = integer_t;
pub const struct_thread_throughput_qos_policy = extern struct {
    thread_throughput_qos_tier: thread_throughput_qos_t,
};
pub const thread_throughput_qos_policy_data_t = struct_thread_throughput_qos_policy;
pub const thread_throughput_qos_policy_t = [*c]struct_thread_throughput_qos_policy;
pub const alarm_type_t = c_int;
pub const sleep_type_t = c_int;
pub const clock_id_t = c_int;
pub const clock_flavor_t = c_int;
pub const clock_attr_t = [*c]c_int;
pub const clock_res_t = c_int;
pub const struct_mach_timespec = extern struct {
    tv_sec: c_uint,
    tv_nsec: clock_res_t,
};
pub const mach_timespec_t = struct_mach_timespec;
pub extern var vm_page_size: vm_size_t;
pub extern var vm_page_mask: vm_size_t;
pub extern var vm_page_shift: c_int;
pub extern var vm_kernel_page_size: vm_size_t;
pub extern var vm_kernel_page_mask: vm_size_t;
pub extern var vm_kernel_page_shift: c_int;
pub const vm32_object_id_t = u32;

pub const task_t = mach_port_t;
pub const task_name_t = mach_port_t;
pub const task_policy_set_t = mach_port_t;
pub const task_policy_get_t = mach_port_t;
pub const task_inspect_t = mach_port_t;
pub const task_read_t = mach_port_t;
pub const task_suspension_token_t = mach_port_t;
pub const thread_t = mach_port_t;
pub const thread_act_t = mach_port_t;
pub const thread_inspect_t = mach_port_t;
pub const thread_read_t = mach_port_t;
pub const ipc_space_t = mach_port_t;
pub const ipc_space_read_t = mach_port_t;
pub const ipc_space_inspect_t = mach_port_t;
pub const coalition_t = mach_port_t;
pub const host_t = mach_port_t;
pub const host_priv_t = mach_port_t;
pub const host_security_t = mach_port_t;
pub const processor_t = mach_port_t;
pub const processor_set_t = mach_port_t;
pub const processor_set_control_t = mach_port_t;
pub const semaphore_t = mach_port_t;
pub const lock_set_t = mach_port_t;
pub const ledger_t = mach_port_t;
pub const alarm_t = mach_port_t;
pub const clock_serv_t = mach_port_t;
pub const clock_ctrl_t = mach_port_t;
pub const arcade_register_t = mach_port_t;
pub const ipc_eventlink_t = mach_port_t;
pub const eventlink_port_pair_t = [2]mach_port_t;
pub const suid_cred_t = mach_port_t;
pub const task_id_token_t = mach_port_t;
pub const processor_set_name_t = processor_set_t;
pub const clock_reply_t = mach_port_t;
pub const bootstrap_t = mach_port_t;
pub const mem_entry_name_port_t = mach_port_t;
pub const exception_handler_t = mach_port_t;
pub const exception_handler_array_t = [*c]exception_handler_t;
pub const vm_task_entry_t = mach_port_t;
pub const io_master_t = mach_port_t;
pub const UNDServerRef = mach_port_t;
pub const mach_eventlink_t = mach_port_t;
pub const exception_handler_info_t = ipc_info_port_t;
pub const task_array_t = [*c]task_t;
pub const thread_array_t = [*c]thread_t;
pub const processor_set_array_t = [*c]processor_set_t;
pub const processor_set_name_array_t = [*c]processor_set_t;
pub const processor_array_t = [*c]processor_t;
pub const thread_act_array_t = [*c]thread_act_t;
pub const ledger_array_t = [*c]ledger_t;
pub const task_port_t = task_t;
pub const task_port_array_t = task_array_t;
pub const thread_port_t = thread_t;
pub const thread_port_array_t = thread_array_t;
pub const ipc_space_port_t = ipc_space_t;
pub const host_name_t = host_t;
pub const host_name_port_t = host_t;
pub const processor_set_port_t = processor_set_t;
pub const processor_set_name_port_t = processor_set_t;
pub const processor_set_name_port_array_t = processor_set_array_t;
pub const processor_set_control_port_t = processor_set_t;
pub const processor_port_t = processor_t;
pub const processor_port_array_t = processor_array_t;
pub const thread_act_port_t = thread_act_t;
pub const thread_act_port_array_t = thread_act_array_t;
pub const semaphore_port_t = semaphore_t;
pub const lock_set_port_t = lock_set_t;
pub const ledger_port_t = ledger_t;
pub const ledger_port_array_t = ledger_array_t;
pub const alarm_port_t = alarm_t;
pub const clock_serv_port_t = clock_serv_t;
pub const clock_ctrl_port_t = clock_ctrl_t;
pub const exception_port_t = exception_handler_t;
pub const exception_port_arrary_t = exception_handler_array_t;
pub const vfs_path_t = [4096]u8;
pub const nspace_path_t = [1024]u8;
pub const nspace_name_t = [1024]u8;
pub const suid_cred_path_t = [1024]u8;
pub const suid_cred_uid_t = u32;
pub const mach_task_flavor_t = c_uint;
pub const mach_thread_flavor_t = c_uint;
pub const ledger_item_t = natural_t;
pub const ledger_amount_t = i64;
pub const emulation_vector_t = [*c]mach_vm_offset_t;
pub const user_subsystem_t = [*c]u8;
pub const labelstr_t = [*c]u8;
pub const __darwin_nl_item = c_int;
pub const __darwin_wctrans_t = c_int;
pub const __darwin_wctype_t = __uint32_t;
pub const struct__OSUnalignedU16 = packed struct {
    __val: u16,
};
pub const struct__OSUnalignedU32 = packed struct {
    __val: u32,
};
pub const struct__OSUnalignedU64 = packed struct {
    __val: u64,
};
pub const OSUnknownByteOrder: c_int = 0;
pub const OSLittleEndian: c_int = 1;
pub const OSBigEndian: c_int = 2;
const enum_unnamed_3 = c_uint;
pub fn OSHostByteOrder() callconv(.C) i32 {
    return OSLittleEndian;
}
pub fn _OSReadInt16(arg_base: ?*const volatile anyopaque, arg_byteOffset: usize) callconv(.C) u16 {
    var base = arg_base;
    var byteOffset = arg_byteOffset;
    return @intToPtr([*c]volatile u16, @intCast(usize, @ptrToInt(base)) +% byteOffset).*;
}
pub fn _OSReadInt32(arg_base: ?*const volatile anyopaque, arg_byteOffset: usize) callconv(.C) u32 {
    var base = arg_base;
    var byteOffset = arg_byteOffset;
    return @intToPtr([*c]volatile u32, @intCast(usize, @ptrToInt(base)) +% byteOffset).*;
}
pub fn _OSReadInt64(arg_base: ?*const volatile anyopaque, arg_byteOffset: usize) callconv(.C) u64 {
    var base = arg_base;
    var byteOffset = arg_byteOffset;
    return @intToPtr([*c]volatile u64, @intCast(usize, @ptrToInt(base)) +% byteOffset).*;
}
pub fn _OSWriteInt16(arg_base: ?*volatile anyopaque, arg_byteOffset: usize, arg_data: u16) callconv(.C) void {
    var base = arg_base;
    var byteOffset = arg_byteOffset;
    var data = arg_data;
    @intToPtr([*c]volatile u16, @intCast(usize, @ptrToInt(base)) +% byteOffset).* = data;
}
pub fn _OSWriteInt32(arg_base: ?*volatile anyopaque, arg_byteOffset: usize, arg_data: u32) callconv(.C) void {
    var base = arg_base;
    var byteOffset = arg_byteOffset;
    var data = arg_data;
    @intToPtr([*c]volatile u32, @intCast(usize, @ptrToInt(base)) +% byteOffset).* = data;
}
pub fn _OSWriteInt64(arg_base: ?*volatile anyopaque, arg_byteOffset: usize, arg_data: u64) callconv(.C) void {
    var base = arg_base;
    var byteOffset = arg_byteOffset;
    var data = arg_data;
    @intToPtr([*c]volatile u64, @intCast(usize, @ptrToInt(base)) +% byteOffset).* = data;
}
pub const NDR_record_t = extern struct {
    mig_vers: u8,
    if_vers: u8,
    reserved1: u8,
    mig_encoding: u8,
    int_rep: u8,
    char_rep: u8,
    float_rep: u8,
    reserved2: u8,
};
pub extern var NDR_record: NDR_record_t;
pub const notify_port_t = mach_port_t;
pub const mach_port_deleted_notification_t = extern struct {
    not_header: mach_msg_header_t,
    NDR: NDR_record_t,
    not_port: mach_port_name_t,
    trailer: mach_msg_format_0_trailer_t,
};
pub const mach_send_possible_notification_t = extern struct {
    not_header: mach_msg_header_t,
    NDR: NDR_record_t,
    not_port: mach_port_name_t,
    trailer: mach_msg_format_0_trailer_t,
};
pub const mach_port_destroyed_notification_t = extern struct {
    not_header: mach_msg_header_t,
    not_body: mach_msg_body_t,
    not_port: mach_msg_port_descriptor_t,
    trailer: mach_msg_format_0_trailer_t,
};
pub const mach_no_senders_notification_t = extern struct {
    not_header: mach_msg_header_t,
    NDR: NDR_record_t,
    not_count: mach_msg_type_number_t,
    trailer: mach_msg_format_0_trailer_t,
};
pub const mach_send_once_notification_t = extern struct {
    not_header: mach_msg_header_t,
    trailer: mach_msg_format_0_trailer_t,
};
pub const mach_dead_name_notification_t = extern struct {
    not_header: mach_msg_header_t,
    NDR: NDR_record_t,
    not_port: mach_port_name_t,
    trailer: mach_msg_format_0_trailer_t,
};
pub const mig_stub_routine_t = ?fn ([*c]mach_msg_header_t, [*c]mach_msg_header_t) callconv(.C) void;
pub const mig_routine_t = mig_stub_routine_t;
pub const mig_server_routine_t = ?fn ([*c]mach_msg_header_t) callconv(.C) mig_routine_t;
pub const mig_impl_routine_t = ?fn () callconv(.C) kern_return_t;
pub const routine_arg_descriptor = mach_msg_type_descriptor_t;
pub const routine_arg_descriptor_t = ?*mach_msg_type_descriptor_t;
pub const mig_routine_arg_descriptor_t = ?*mach_msg_type_descriptor_t;
pub const struct_routine_descriptor = extern struct {
    impl_routine: mig_impl_routine_t,
    stub_routine: mig_stub_routine_t,
    argc: c_uint,
    descr_count: c_uint,
    arg_descr: routine_arg_descriptor_t,
    max_reply_msg: c_uint,
};
pub const routine_descriptor_t = [*c]struct_routine_descriptor;
pub const mig_routine_descriptor = struct_routine_descriptor;
pub const mig_routine_descriptor_t = [*c]mig_routine_descriptor;
pub const struct_mig_subsystem = extern struct {
    server: mig_server_routine_t,
    start: mach_msg_id_t,
    end: mach_msg_id_t,
    maxsize: mach_msg_size_t,
    reserved: vm_address_t,
    routine: [1]mig_routine_descriptor,
};
pub const mig_subsystem_t = [*c]struct_mig_subsystem;
pub const struct_mig_symtab = extern struct {
    ms_routine_name: [*c]u8,
    ms_routine_number: c_int,
    ms_routine: ?fn () callconv(.C) void,
};
pub const mig_symtab_t = struct_mig_symtab;
pub extern fn mig_get_reply_port() mach_port_t;
pub extern fn mig_dealloc_reply_port(reply_port: mach_port_t) void;
pub extern fn mig_put_reply_port(reply_port: mach_port_t) void;
pub extern fn mig_strncpy(dest: [*c]u8, src: [*c]const u8, len: c_int) c_int;
pub extern fn mig_strncpy_zerofill(dest: [*c]u8, src: [*c]const u8, len: c_int) c_int;
pub extern fn mig_allocate([*c]vm_address_t, vm_size_t) void;
pub extern fn mig_deallocate(vm_address_t, vm_size_t) void;
pub const mig_reply_error_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
};
pub fn __NDR_convert__mig_reply_error_t(arg_x: [*c]mig_reply_error_t) callconv(.C) void {
    var x = arg_x;
    _ = x;
}
pub extern fn clock_set_time(clock_ctrl: clock_ctrl_t, new_time: mach_timespec_t) kern_return_t;
pub extern fn clock_set_attributes(clock_ctrl: clock_ctrl_t, flavor: clock_flavor_t, clock_attr: clock_attr_t, clock_attrCnt: mach_msg_type_number_t) kern_return_t;
pub const __Request__clock_set_time_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    new_time: mach_timespec_t,
};
pub const __Request__clock_set_attributes_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    flavor: clock_flavor_t,
    clock_attrCnt: mach_msg_type_number_t,
    clock_attr: [1]c_int,
};
pub const union___RequestUnion__clock_priv_subsystem = extern union {
    Request_clock_set_time: __Request__clock_set_time_t,
    Request_clock_set_attributes: __Request__clock_set_attributes_t,
};
pub const __Reply__clock_set_time_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
};
pub const __Reply__clock_set_attributes_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
};
pub const union___ReplyUnion__clock_priv_subsystem = extern union {
    Reply_clock_set_time: __Reply__clock_set_time_t,
    Reply_clock_set_attributes: __Reply__clock_set_attributes_t,
};

pub const struct_zone_info = extern struct {
    zi_count: integer_t,
    zi_cur_size: vm_size_t,
    zi_max_size: vm_size_t,
    zi_elem_size: vm_size_t,
    zi_alloc_size: vm_size_t,
    zi_pageable: integer_t,
    zi_sleepable: integer_t,
    zi_exhaustible: integer_t,
    zi_collectable: integer_t,
};
pub const zone_info_t = struct_zone_info;
pub const zone_info_array_t = [*c]zone_info_t;
pub const struct_mach_zone_name = extern struct {
    mzn_name: [80]u8,
};
pub const mach_zone_name_t = struct_mach_zone_name;
pub const mach_zone_name_array_t = [*c]mach_zone_name_t;
pub const struct_mach_zone_info_data = extern struct {
    mzi_count: u64,
    mzi_cur_size: u64,
    mzi_max_size: u64,
    mzi_elem_size: u64,
    mzi_alloc_size: u64,
    mzi_sum_size: u64,
    mzi_exhaustible: u64,
    mzi_collectable: u64,
};
pub const mach_zone_info_t = struct_mach_zone_info_data;
pub const mach_zone_info_array_t = [*c]mach_zone_info_t;
pub const struct_task_zone_info_data = extern struct {
    tzi_count: u64,
    tzi_cur_size: u64,
    tzi_max_size: u64,
    tzi_elem_size: u64,
    tzi_alloc_size: u64,
    tzi_sum_size: u64,
    tzi_exhaustible: u64,
    tzi_collectable: u64,
    tzi_caller_acct: u64,
    tzi_task_alloc: u64,
    tzi_task_free: u64,
};
pub const task_zone_info_t = struct_task_zone_info_data;
pub const task_zone_info_array_t = [*c]task_zone_info_t;
pub const struct_mach_memory_info = extern struct {
    flags: u64,
    site: u64,
    size: u64,
    free: u64,
    largest: u64,
    collectable_bytes: u64,
    mapped: u64,
    peak: u64,
    tag: u16,
    zone: u16,
    _resvA: [2]u16,
    _resv: [3]u64,
    name: [80]u8,
};
pub const mach_memory_info_t = struct_mach_memory_info;
pub const mach_memory_info_array_t = [*c]mach_memory_info_t;
pub const struct_zone_btrecord = extern struct {
    ref_count: u32,
    operation_type: u32,
    bt: [15]u64,
};
pub const zone_btrecord_t = struct_zone_btrecord;
pub const zone_btrecord_array_t = [*c]zone_btrecord_t;
pub const page_address_array_t = [*c]vm_offset_t;
pub const struct_hash_info_bucket = extern struct {
    hib_count: natural_t,
};
pub const hash_info_bucket_t = struct_hash_info_bucket;
pub const hash_info_bucket_array_t = [*c]hash_info_bucket_t;
pub const struct_lockgroup_info = extern struct {
    lockgroup_name: [64]u8,
    lockgroup_attr: u64,
    lock_spin_cnt: u64,
    lock_spin_util_cnt: u64,
    lock_spin_held_cnt: u64,
    lock_spin_miss_cnt: u64,
    lock_spin_held_max: u64,
    lock_spin_held_cum: u64,
    lock_mtx_cnt: u64,
    lock_mtx_util_cnt: u64,
    lock_mtx_held_cnt: u64,
    lock_mtx_miss_cnt: u64,
    lock_mtx_wait_cnt: u64,
    lock_mtx_held_max: u64,
    lock_mtx_held_cum: u64,
    lock_mtx_wait_max: u64,
    lock_mtx_wait_cum: u64,
    lock_rw_cnt: u64,
    lock_rw_util_cnt: u64,
    lock_rw_held_cnt: u64,
    lock_rw_miss_cnt: u64,
    lock_rw_wait_cnt: u64,
    lock_rw_held_max: u64,
    lock_rw_held_cum: u64,
    lock_rw_wait_max: u64,
    lock_rw_wait_cum: u64,
};
pub const lockgroup_info_t = struct_lockgroup_info;
pub const lockgroup_info_array_t = [*c]lockgroup_info_t;
pub const symtab_name_t = [32]u8;
pub const struct_mach_core_details = extern struct {
    gzip_offset: u64,
    gzip_length: u64,
    core_name: [16]u8,
};
pub const struct_mach_core_fileheader = extern struct {
    signature: u64,
    log_offset: u64,
    log_length: u64,
    num_files: u64,
    files: [16]struct_mach_core_details,
};
pub const struct_mach_core_details_v2 = extern struct {
    flags: u64,
    offset: u64,
    length: u64,
    core_name: [16]u8,
};
pub const struct_mach_core_fileheader_base = extern struct {
    signature: u64,
    version: u32,
};
pub const struct_mach_core_fileheader_v2 = extern struct {
    signature: u64 align(8),
    version: u32,
    flags: u64,
    pub_key_offset: u64,
    pub_key_length: u16,
    log_offset: u64,
    log_length: u64,
    num_files: u64,
    pub fn files(self: anytype) @import("std").zig.c_translation.FlexibleArrayType(@TypeOf(self), struct_mach_core_details_v2) {
        const Intermediate = @import("std").zig.c_translation.FlexibleArrayType(@TypeOf(self), u8);
        const ReturnType = @import("std").zig.c_translation.FlexibleArrayType(@TypeOf(self), struct_mach_core_details_v2);
        return @ptrCast(ReturnType, @alignCast(@alignOf(struct_mach_core_details_v2), @ptrCast(Intermediate, self) + 64));
    }
};
pub const kobject_description_t = [512]u8;
pub const sync_policy_t = c_int;
pub extern fn mach_port_names(task: ipc_space_t, names: [*c]mach_port_name_array_t, namesCnt: [*c]mach_msg_type_number_t, types: [*c]mach_port_type_array_t, typesCnt: [*c]mach_msg_type_number_t) kern_return_t;
pub extern fn mach_port_type(task: ipc_space_t, name: mach_port_name_t, ptype: [*c]mach_port_type_t) kern_return_t;
pub extern fn mach_port_rename(task: ipc_space_t, old_name: mach_port_name_t, new_name: mach_port_name_t) kern_return_t;
pub extern fn mach_port_allocate_name(task: ipc_space_t, right: mach_port_right_t, name: mach_port_name_t) kern_return_t;
pub extern fn mach_port_allocate(task: ipc_space_t, right: mach_port_right_t, name: [*c]mach_port_name_t) kern_return_t;
pub extern fn mach_port_destroy(task: ipc_space_t, name: mach_port_name_t) kern_return_t;
pub extern fn mach_port_deallocate(task: ipc_space_t, name: mach_port_name_t) kern_return_t;
pub extern fn mach_port_get_refs(task: ipc_space_t, name: mach_port_name_t, right: mach_port_right_t, refs: [*c]mach_port_urefs_t) kern_return_t;
pub extern fn mach_port_mod_refs(task: ipc_space_t, name: mach_port_name_t, right: mach_port_right_t, delta: mach_port_delta_t) kern_return_t;
pub extern fn mach_port_peek(task: ipc_space_t, name: mach_port_name_t, trailer_type: mach_msg_trailer_type_t, request_seqnop: [*c]mach_port_seqno_t, msg_sizep: [*c]mach_msg_size_t, msg_idp: [*c]mach_msg_id_t, trailer_infop: mach_msg_trailer_info_t, trailer_infopCnt: [*c]mach_msg_type_number_t) kern_return_t;
pub extern fn mach_port_set_mscount(task: ipc_space_t, name: mach_port_name_t, mscount: mach_port_mscount_t) kern_return_t;
pub extern fn mach_port_get_set_status(task: ipc_space_read_t, name: mach_port_name_t, members: [*c]mach_port_name_array_t, membersCnt: [*c]mach_msg_type_number_t) kern_return_t;
pub extern fn mach_port_move_member(task: ipc_space_t, member: mach_port_name_t, after: mach_port_name_t) kern_return_t;
pub extern fn mach_port_request_notification(task: ipc_space_t, name: mach_port_name_t, msgid: mach_msg_id_t, sync: mach_port_mscount_t, notify: mach_port_t, notifyPoly: mach_msg_type_name_t, previous: [*c]mach_port_t) kern_return_t;
pub extern fn mach_port_insert_right(task: ipc_space_t, name: mach_port_name_t, poly: mach_port_t, polyPoly: mach_msg_type_name_t) kern_return_t;
pub extern fn mach_port_extract_right(task: ipc_space_t, name: mach_port_name_t, msgt_name: mach_msg_type_name_t, poly: [*c]mach_port_t, polyPoly: [*c]mach_msg_type_name_t) kern_return_t;
pub extern fn mach_port_set_seqno(task: ipc_space_t, name: mach_port_name_t, seqno: mach_port_seqno_t) kern_return_t;
pub extern fn mach_port_get_attributes(task: ipc_space_read_t, name: mach_port_name_t, flavor: mach_port_flavor_t, port_info_out: mach_port_info_t, port_info_outCnt: [*c]mach_msg_type_number_t) kern_return_t;
pub extern fn mach_port_set_attributes(task: ipc_space_t, name: mach_port_name_t, flavor: mach_port_flavor_t, port_info: mach_port_info_t, port_infoCnt: mach_msg_type_number_t) kern_return_t;
pub extern fn mach_port_allocate_qos(task: ipc_space_t, right: mach_port_right_t, qos: ?*mach_port_qos_t, name: [*c]mach_port_name_t) kern_return_t;
pub extern fn mach_port_allocate_full(task: ipc_space_t, right: mach_port_right_t, proto: mach_port_t, qos: ?*mach_port_qos_t, name: [*c]mach_port_name_t) kern_return_t;
pub extern fn task_set_port_space(task: ipc_space_t, table_entries: c_int) kern_return_t;
pub extern fn mach_port_get_srights(task: ipc_space_t, name: mach_port_name_t, srights: [*c]mach_port_rights_t) kern_return_t;
pub extern fn mach_port_space_info(space: ipc_space_read_t, space_info: [*c]ipc_info_space_t, table_info: [*c]ipc_info_name_array_t, table_infoCnt: [*c]mach_msg_type_number_t, tree_info: [*c]ipc_info_tree_name_array_t, tree_infoCnt: [*c]mach_msg_type_number_t) kern_return_t;
pub extern fn mach_port_dnrequest_info(task: ipc_space_t, name: mach_port_name_t, dnr_total: [*c]c_uint, dnr_used: [*c]c_uint) kern_return_t;
pub extern fn mach_port_kernel_object(task: ipc_space_read_t, name: mach_port_name_t, object_type: [*c]c_uint, object_addr: [*c]c_uint) kern_return_t;
pub extern fn mach_port_insert_member(task: ipc_space_t, name: mach_port_name_t, pset: mach_port_name_t) kern_return_t;
pub extern fn mach_port_extract_member(task: ipc_space_t, name: mach_port_name_t, pset: mach_port_name_t) kern_return_t;
pub extern fn mach_port_get_context(task: ipc_space_read_t, name: mach_port_name_t, context: [*c]mach_port_context_t) kern_return_t;
pub extern fn mach_port_set_context(task: ipc_space_t, name: mach_port_name_t, context: mach_port_context_t) kern_return_t;
pub extern fn mach_port_kobject(task: ipc_space_read_t, name: mach_port_name_t, object_type: [*c]natural_t, object_addr: [*c]mach_vm_address_t) kern_return_t;
pub extern fn mach_port_construct(task: ipc_space_t, options: mach_port_options_ptr_t, context: mach_port_context_t, name: [*c]mach_port_name_t) kern_return_t;
pub extern fn mach_port_destruct(task: ipc_space_t, name: mach_port_name_t, srdelta: mach_port_delta_t, guard: mach_port_context_t) kern_return_t;
pub extern fn mach_port_guard(task: ipc_space_t, name: mach_port_name_t, guard: mach_port_context_t, strict: boolean_t) kern_return_t;
pub extern fn mach_port_unguard(task: ipc_space_t, name: mach_port_name_t, guard: mach_port_context_t) kern_return_t;
pub extern fn mach_port_space_basic_info(task: ipc_space_inspect_t, basic_info: [*c]ipc_info_space_basic_t) kern_return_t;
pub extern fn mach_port_guard_with_flags(task: ipc_space_t, name: mach_port_name_t, guard: mach_port_context_t, flags: u64) kern_return_t;
pub extern fn mach_port_swap_guard(task: ipc_space_t, name: mach_port_name_t, old_guard: mach_port_context_t, new_guard: mach_port_context_t) kern_return_t;
pub extern fn mach_port_kobject_description(task: ipc_space_read_t, name: mach_port_name_t, object_type: [*c]natural_t, object_addr: [*c]mach_vm_address_t, description: [*c]u8) kern_return_t;
pub extern fn mach_port_is_connection_for_service(task: ipc_space_t, connection_port: mach_port_name_t, service_port: mach_port_name_t, filter_policy_id: [*c]u64) kern_return_t;
pub extern fn mach_port_get_service_port_info(task: ipc_space_read_t, name: mach_port_name_t, sp_info_out: [*c]mach_service_port_info_data_t) kern_return_t;
pub extern fn mach_port_assert_attributes(task: ipc_space_t, name: mach_port_name_t, flavor: mach_port_flavor_t, info: mach_port_info_t, infoCnt: mach_msg_type_number_t) kern_return_t;
pub const __Request__mach_port_names_t = extern struct {
    Head: mach_msg_header_t,
};
pub const __Request__mach_port_type_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    name: mach_port_name_t,
};
pub const __Request__mach_port_rename_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    old_name: mach_port_name_t,
    new_name: mach_port_name_t,
};
pub const __Request__mach_port_allocate_name_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    right: mach_port_right_t,
    name: mach_port_name_t,
};
pub const __Request__mach_port_allocate_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    right: mach_port_right_t,
};
pub const __Request__mach_port_destroy_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    name: mach_port_name_t,
};
pub const __Request__mach_port_deallocate_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    name: mach_port_name_t,
};
pub const __Request__mach_port_get_refs_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    name: mach_port_name_t,
    right: mach_port_right_t,
};
pub const __Request__mach_port_mod_refs_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    name: mach_port_name_t,
    right: mach_port_right_t,
    delta: mach_port_delta_t,
};
pub const __Request__mach_port_peek_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    name: mach_port_name_t,
    trailer_type: mach_msg_trailer_type_t,
    request_seqnop: mach_port_seqno_t,
    trailer_infopCnt: mach_msg_type_number_t,
};
pub const __Request__mach_port_set_mscount_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    name: mach_port_name_t,
    mscount: mach_port_mscount_t,
};
pub const __Request__mach_port_get_set_status_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    name: mach_port_name_t,
};
pub const __Request__mach_port_move_member_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    member: mach_port_name_t,
    after: mach_port_name_t,
};
pub const __Request__mach_port_request_notification_t = extern struct {
    Head: mach_msg_header_t,
    msgh_body: mach_msg_body_t,
    notify: mach_msg_port_descriptor_t,
    NDR: NDR_record_t,
    name: mach_port_name_t,
    msgid: mach_msg_id_t,
    sync: mach_port_mscount_t,
};
pub const __Request__mach_port_insert_right_t = extern struct {
    Head: mach_msg_header_t,
    msgh_body: mach_msg_body_t,
    poly: mach_msg_port_descriptor_t,
    NDR: NDR_record_t,
    name: mach_port_name_t,
};
pub const __Request__mach_port_extract_right_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    name: mach_port_name_t,
    msgt_name: mach_msg_type_name_t,
};
pub const __Request__mach_port_set_seqno_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    name: mach_port_name_t,
    seqno: mach_port_seqno_t,
};
pub const __Request__mach_port_get_attributes_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    name: mach_port_name_t,
    flavor: mach_port_flavor_t,
    port_info_outCnt: mach_msg_type_number_t,
};
pub const __Request__mach_port_set_attributes_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    name: mach_port_name_t,
    flavor: mach_port_flavor_t,
    port_infoCnt: mach_msg_type_number_t,
    port_info: [17]integer_t,
};
pub const __Request__mach_port_allocate_qos_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    right: mach_port_right_t,
    qos: mach_port_qos_t,
};
pub const __Request__mach_port_allocate_full_t = extern struct {
    Head: mach_msg_header_t,
    msgh_body: mach_msg_body_t,
    proto: mach_msg_port_descriptor_t,
    NDR: NDR_record_t,
    right: mach_port_right_t,
    qos: mach_port_qos_t,
    name: mach_port_name_t,
};
pub const __Request__task_set_port_space_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    table_entries: c_int,
};
pub const __Request__mach_port_get_srights_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    name: mach_port_name_t,
};
pub const __Request__mach_port_space_info_t = extern struct {
    Head: mach_msg_header_t,
};
pub const __Request__mach_port_dnrequest_info_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    name: mach_port_name_t,
};
pub const __Request__mach_port_kernel_object_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    name: mach_port_name_t,
};
pub const __Request__mach_port_insert_member_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    name: mach_port_name_t,
    pset: mach_port_name_t,
};
pub const __Request__mach_port_extract_member_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    name: mach_port_name_t,
    pset: mach_port_name_t,
};
pub const __Request__mach_port_get_context_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    name: mach_port_name_t,
};
pub const __Request__mach_port_set_context_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    name: mach_port_name_t,
    context: mach_port_context_t,
};
pub const __Request__mach_port_kobject_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    name: mach_port_name_t,
};
pub const __Request__mach_port_construct_t = extern struct {
    Head: mach_msg_header_t,
    msgh_body: mach_msg_body_t,
    options: mach_msg_ool_descriptor_t,
    NDR: NDR_record_t,
    context: mach_port_context_t,
};
pub const __Request__mach_port_destruct_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    name: mach_port_name_t,
    srdelta: mach_port_delta_t,
    guard: mach_port_context_t,
};
pub const __Request__mach_port_guard_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    name: mach_port_name_t,
    guard: mach_port_context_t,
    strict: boolean_t,
};
pub const __Request__mach_port_unguard_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    name: mach_port_name_t,
    guard: mach_port_context_t,
};
pub const __Request__mach_port_space_basic_info_t = extern struct {
    Head: mach_msg_header_t,
};
pub const __Request__mach_port_guard_with_flags_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    name: mach_port_name_t,
    guard: mach_port_context_t,
    flags: u64,
};
pub const __Request__mach_port_swap_guard_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    name: mach_port_name_t,
    old_guard: mach_port_context_t,
    new_guard: mach_port_context_t,
};
pub const __Request__mach_port_kobject_description_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    name: mach_port_name_t,
};
pub const __Request__mach_port_is_connection_for_service_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    connection_port: mach_port_name_t,
    service_port: mach_port_name_t,
};
pub const __Request__mach_port_get_service_port_info_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    name: mach_port_name_t,
};
pub const __Request__mach_port_assert_attributes_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    name: mach_port_name_t,
    flavor: mach_port_flavor_t,
    infoCnt: mach_msg_type_number_t,
    info: [17]integer_t,
};
pub const union___RequestUnion__mach_port_subsystem = extern union {
    Request_mach_port_names: __Request__mach_port_names_t,
    Request_mach_port_type: __Request__mach_port_type_t,
    Request_mach_port_rename: __Request__mach_port_rename_t,
    Request_mach_port_allocate_name: __Request__mach_port_allocate_name_t,
    Request_mach_port_allocate: __Request__mach_port_allocate_t,
    Request_mach_port_destroy: __Request__mach_port_destroy_t,
    Request_mach_port_deallocate: __Request__mach_port_deallocate_t,
    Request_mach_port_get_refs: __Request__mach_port_get_refs_t,
    Request_mach_port_mod_refs: __Request__mach_port_mod_refs_t,
    Request_mach_port_peek: __Request__mach_port_peek_t,
    Request_mach_port_set_mscount: __Request__mach_port_set_mscount_t,
    Request_mach_port_get_set_status: __Request__mach_port_get_set_status_t,
    Request_mach_port_move_member: __Request__mach_port_move_member_t,
    Request_mach_port_request_notification: __Request__mach_port_request_notification_t,
    Request_mach_port_insert_right: __Request__mach_port_insert_right_t,
    Request_mach_port_extract_right: __Request__mach_port_extract_right_t,
    Request_mach_port_set_seqno: __Request__mach_port_set_seqno_t,
    Request_mach_port_get_attributes: __Request__mach_port_get_attributes_t,
    Request_mach_port_set_attributes: __Request__mach_port_set_attributes_t,
    Request_mach_port_allocate_qos: __Request__mach_port_allocate_qos_t,
    Request_mach_port_allocate_full: __Request__mach_port_allocate_full_t,
    Request_task_set_port_space: __Request__task_set_port_space_t,
    Request_mach_port_get_srights: __Request__mach_port_get_srights_t,
    Request_mach_port_space_info: __Request__mach_port_space_info_t,
    Request_mach_port_dnrequest_info: __Request__mach_port_dnrequest_info_t,
    Request_mach_port_kernel_object: __Request__mach_port_kernel_object_t,
    Request_mach_port_insert_member: __Request__mach_port_insert_member_t,
    Request_mach_port_extract_member: __Request__mach_port_extract_member_t,
    Request_mach_port_get_context: __Request__mach_port_get_context_t,
    Request_mach_port_set_context: __Request__mach_port_set_context_t,
    Request_mach_port_kobject: __Request__mach_port_kobject_t,
    Request_mach_port_construct: __Request__mach_port_construct_t,
    Request_mach_port_destruct: __Request__mach_port_destruct_t,
    Request_mach_port_guard: __Request__mach_port_guard_t,
    Request_mach_port_unguard: __Request__mach_port_unguard_t,
    Request_mach_port_space_basic_info: __Request__mach_port_space_basic_info_t,
    Request_mach_port_guard_with_flags: __Request__mach_port_guard_with_flags_t,
    Request_mach_port_swap_guard: __Request__mach_port_swap_guard_t,
    Request_mach_port_kobject_description: __Request__mach_port_kobject_description_t,
    Request_mach_port_is_connection_for_service: __Request__mach_port_is_connection_for_service_t,
    Request_mach_port_get_service_port_info: __Request__mach_port_get_service_port_info_t,
    Request_mach_port_assert_attributes: __Request__mach_port_assert_attributes_t,
};
pub const __Reply__mach_port_names_t = extern struct {
    Head: mach_msg_header_t,
    msgh_body: mach_msg_body_t,
    names: mach_msg_ool_descriptor_t,
    types: mach_msg_ool_descriptor_t,
    NDR: NDR_record_t,
    namesCnt: mach_msg_type_number_t,
    typesCnt: mach_msg_type_number_t,
};
pub const __Reply__mach_port_type_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
    ptype: mach_port_type_t,
};
pub const __Reply__mach_port_rename_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
};
pub const __Reply__mach_port_allocate_name_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
};
pub const __Reply__mach_port_allocate_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
    name: mach_port_name_t,
};
pub const __Reply__mach_port_destroy_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
};
pub const __Reply__mach_port_deallocate_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
};
pub const __Reply__mach_port_get_refs_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
    refs: mach_port_urefs_t,
};
pub const __Reply__mach_port_mod_refs_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
};
pub const __Reply__mach_port_peek_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
    request_seqnop: mach_port_seqno_t,
    msg_sizep: mach_msg_size_t,
    msg_idp: mach_msg_id_t,
    trailer_infopCnt: mach_msg_type_number_t,
    trailer_infop: [68]u8,
};
pub const __Reply__mach_port_set_mscount_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
};
pub const __Reply__mach_port_get_set_status_t = extern struct {
    Head: mach_msg_header_t,
    msgh_body: mach_msg_body_t,
    members: mach_msg_ool_descriptor_t,
    NDR: NDR_record_t,
    membersCnt: mach_msg_type_number_t,
};
pub const __Reply__mach_port_move_member_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
};
pub const __Reply__mach_port_request_notification_t = extern struct {
    Head: mach_msg_header_t,
    msgh_body: mach_msg_body_t,
    previous: mach_msg_port_descriptor_t,
};
pub const __Reply__mach_port_insert_right_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
};
pub const __Reply__mach_port_extract_right_t = extern struct {
    Head: mach_msg_header_t,
    msgh_body: mach_msg_body_t,
    poly: mach_msg_port_descriptor_t,
};
pub const __Reply__mach_port_set_seqno_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
};
pub const __Reply__mach_port_get_attributes_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
    port_info_outCnt: mach_msg_type_number_t,
    port_info_out: [17]integer_t,
};
pub const __Reply__mach_port_set_attributes_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
};
pub const __Reply__mach_port_allocate_qos_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
    qos: mach_port_qos_t,
    name: mach_port_name_t,
};
pub const __Reply__mach_port_allocate_full_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
    qos: mach_port_qos_t,
    name: mach_port_name_t,
};
pub const __Reply__task_set_port_space_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
};
pub const __Reply__mach_port_get_srights_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
    srights: mach_port_rights_t,
};
pub const __Reply__mach_port_space_info_t = extern struct {
    Head: mach_msg_header_t,
    msgh_body: mach_msg_body_t,
    table_info: mach_msg_ool_descriptor_t,
    tree_info: mach_msg_ool_descriptor_t,
    NDR: NDR_record_t,
    space_info: ipc_info_space_t,
    table_infoCnt: mach_msg_type_number_t,
    tree_infoCnt: mach_msg_type_number_t,
};
pub const __Reply__mach_port_dnrequest_info_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
    dnr_total: c_uint,
    dnr_used: c_uint,
};
pub const __Reply__mach_port_kernel_object_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
    object_type: c_uint,
    object_addr: c_uint,
};
pub const __Reply__mach_port_insert_member_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
};
pub const __Reply__mach_port_extract_member_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
};
pub const __Reply__mach_port_get_context_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
    context: mach_port_context_t,
};
pub const __Reply__mach_port_set_context_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
};
pub const __Reply__mach_port_kobject_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
    object_type: natural_t,
    object_addr: mach_vm_address_t,
};
pub const __Reply__mach_port_construct_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
    name: mach_port_name_t,
};
pub const __Reply__mach_port_destruct_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
};
pub const __Reply__mach_port_guard_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
};
pub const __Reply__mach_port_unguard_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
};
pub const __Reply__mach_port_space_basic_info_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
    basic_info: ipc_info_space_basic_t,
};
pub const __Reply__mach_port_guard_with_flags_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
};
pub const __Reply__mach_port_swap_guard_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
};
pub const __Reply__mach_port_kobject_description_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
    object_type: natural_t,
    object_addr: mach_vm_address_t,
    descriptionOffset: mach_msg_type_number_t,
    descriptionCnt: mach_msg_type_number_t,
    description: [512]u8,
};
pub const __Reply__mach_port_is_connection_for_service_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
    filter_policy_id: u64,
};
pub const __Reply__mach_port_get_service_port_info_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
    sp_info_out: mach_service_port_info_data_t,
};
pub const __Reply__mach_port_assert_attributes_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
};
pub const union___ReplyUnion__mach_port_subsystem = extern union {
    Reply_mach_port_names: __Reply__mach_port_names_t,
    Reply_mach_port_type: __Reply__mach_port_type_t,
    Reply_mach_port_rename: __Reply__mach_port_rename_t,
    Reply_mach_port_allocate_name: __Reply__mach_port_allocate_name_t,
    Reply_mach_port_allocate: __Reply__mach_port_allocate_t,
    Reply_mach_port_destroy: __Reply__mach_port_destroy_t,
    Reply_mach_port_deallocate: __Reply__mach_port_deallocate_t,
    Reply_mach_port_get_refs: __Reply__mach_port_get_refs_t,
    Reply_mach_port_mod_refs: __Reply__mach_port_mod_refs_t,
    Reply_mach_port_peek: __Reply__mach_port_peek_t,
    Reply_mach_port_set_mscount: __Reply__mach_port_set_mscount_t,
    Reply_mach_port_get_set_status: __Reply__mach_port_get_set_status_t,
    Reply_mach_port_move_member: __Reply__mach_port_move_member_t,
    Reply_mach_port_request_notification: __Reply__mach_port_request_notification_t,
    Reply_mach_port_insert_right: __Reply__mach_port_insert_right_t,
    Reply_mach_port_extract_right: __Reply__mach_port_extract_right_t,
    Reply_mach_port_set_seqno: __Reply__mach_port_set_seqno_t,
    Reply_mach_port_get_attributes: __Reply__mach_port_get_attributes_t,
    Reply_mach_port_set_attributes: __Reply__mach_port_set_attributes_t,
    Reply_mach_port_allocate_qos: __Reply__mach_port_allocate_qos_t,
    Reply_mach_port_allocate_full: __Reply__mach_port_allocate_full_t,
    Reply_task_set_port_space: __Reply__task_set_port_space_t,
    Reply_mach_port_get_srights: __Reply__mach_port_get_srights_t,
    Reply_mach_port_space_info: __Reply__mach_port_space_info_t,
    Reply_mach_port_dnrequest_info: __Reply__mach_port_dnrequest_info_t,
    Reply_mach_port_kernel_object: __Reply__mach_port_kernel_object_t,
    Reply_mach_port_insert_member: __Reply__mach_port_insert_member_t,
    Reply_mach_port_extract_member: __Reply__mach_port_extract_member_t,
    Reply_mach_port_get_context: __Reply__mach_port_get_context_t,
    Reply_mach_port_set_context: __Reply__mach_port_set_context_t,
    Reply_mach_port_kobject: __Reply__mach_port_kobject_t,
    Reply_mach_port_construct: __Reply__mach_port_construct_t,
    Reply_mach_port_destruct: __Reply__mach_port_destruct_t,
    Reply_mach_port_guard: __Reply__mach_port_guard_t,
    Reply_mach_port_unguard: __Reply__mach_port_unguard_t,
    Reply_mach_port_space_basic_info: __Reply__mach_port_space_basic_info_t,
    Reply_mach_port_guard_with_flags: __Reply__mach_port_guard_with_flags_t,
    Reply_mach_port_swap_guard: __Reply__mach_port_swap_guard_t,
    Reply_mach_port_kobject_description: __Reply__mach_port_kobject_description_t,
    Reply_mach_port_is_connection_for_service: __Reply__mach_port_is_connection_for_service_t,
    Reply_mach_port_get_service_port_info: __Reply__mach_port_get_service_port_info_t,
    Reply_mach_port_assert_attributes: __Reply__mach_port_assert_attributes_t,
};
pub extern fn mach_host_self() mach_port_t;
pub extern fn mach_thread_self() mach_port_t;
pub extern fn mach_task_is_self(task: task_name_t) boolean_t;
pub extern fn host_page_size(host_t, [*c]vm_size_t) kern_return_t;
pub const mach_task_self = std.os.darwin.mach_task_self;
pub extern fn clock_sleep_trap(clock_name: mach_port_name_t, sleep_type: sleep_type_t, sleep_sec: c_int, sleep_nsec: c_int, wakeup_time: [*c]mach_timespec_t) kern_return_t;
pub extern fn task_dyld_process_info_notify_get(names_addr: mach_port_name_array_t, names_count_addr: [*c]natural_t) kern_return_t;
pub extern fn mach_generate_activity_id(target: mach_port_name_t, count: c_int, activity_id: [*c]u64) kern_return_t;
pub extern fn macx_swapon(filename: u64, flags: c_int, size: c_int, priority: c_int) kern_return_t;
pub extern fn macx_swapoff(filename: u64, flags: c_int) kern_return_t;
pub extern fn macx_triggers(hi_water: c_int, low_water: c_int, flags: c_int, alert_port: mach_port_t) kern_return_t;
pub extern fn macx_backing_store_suspend(@"suspend": boolean_t) kern_return_t;
pub extern fn macx_backing_store_recovery(pid: c_int) kern_return_t;
pub extern fn swtch_pri(pri: c_int) boolean_t;
pub extern fn swtch() boolean_t;
pub extern fn thread_switch(thread_name: mach_port_name_t, option: c_int, option_time: mach_msg_timeout_t) kern_return_t;
pub extern fn task_self_trap() mach_port_name_t;
pub extern fn host_create_mach_voucher_trap(host: mach_port_name_t, recipes: mach_voucher_attr_raw_recipe_array_t, recipes_size: c_int, voucher: [*c]mach_port_name_t) kern_return_t;
pub extern fn mach_voucher_extract_attr_recipe_trap(voucher_name: mach_port_name_t, key: mach_voucher_attr_key_t, recipe: mach_voucher_attr_raw_recipe_t, recipe_size: [*c]mach_msg_type_number_t) kern_return_t;
pub extern fn _kernelrpc_mach_port_type_trap(task: ipc_space_t, name: mach_port_name_t, ptype: [*c]mach_port_type_t) kern_return_t;
pub extern fn _kernelrpc_mach_port_request_notification_trap(task: ipc_space_t, name: mach_port_name_t, msgid: mach_msg_id_t, sync: mach_port_mscount_t, notify: mach_port_name_t, notifyPoly: mach_msg_type_name_t, previous: [*c]mach_port_name_t) kern_return_t;
pub extern fn task_for_pid(target_tport: mach_port_name_t, pid: c_int, t: [*c]mach_port_name_t) kern_return_t;
pub extern fn task_name_for_pid(target_tport: mach_port_name_t, pid: c_int, tn: [*c]mach_port_name_t) kern_return_t;
pub extern fn pid_for_task(t: mach_port_name_t, x: [*c]c_int) kern_return_t;
pub extern fn debug_control_port_for_pid(target_tport: mach_port_name_t, pid: c_int, t: [*c]mach_port_name_t) kern_return_t;
pub extern var bootstrap_port: mach_port_t;
pub extern fn host_info(host: host_t, flavor: host_flavor_t, host_info_out: host_info_t, host_info_outCnt: [*c]mach_msg_type_number_t) kern_return_t;
pub extern fn host_kernel_version(host: host_t, kernel_version: [*c]u8) kern_return_t;
pub extern fn _host_page_size(host: host_t, out_page_size: [*c]vm_size_t) kern_return_t;
pub extern fn mach_memory_object_memory_entry(host: host_t, internal: boolean_t, size: vm_size_t, permission: vm_prot_t, pager: memory_object_t, entry_handle: [*c]mach_port_t) kern_return_t;
pub extern fn host_processor_info(host: host_t, flavor: processor_flavor_t, out_processor_count: [*c]natural_t, out_processor_info: [*c]processor_info_array_t, out_processor_infoCnt: [*c]mach_msg_type_number_t) kern_return_t;
pub extern fn host_get_io_master(host: host_t, io_master: [*c]io_master_t) kern_return_t;
pub extern fn host_get_clock_service(host: host_t, clock_id: clock_id_t, clock_serv: [*c]clock_serv_t) kern_return_t;
pub extern fn host_virtual_physical_table_info(host: host_t, info: [*c]hash_info_bucket_array_t, infoCnt: [*c]mach_msg_type_number_t) kern_return_t;
pub extern fn processor_set_default(host: host_t, default_set: [*c]processor_set_name_t) kern_return_t;
pub extern fn processor_set_create(host: host_t, new_set: [*c]processor_set_t, new_name: [*c]processor_set_name_t) kern_return_t;
pub extern fn mach_memory_object_memory_entry_64(host: host_t, internal: boolean_t, size: memory_object_size_t, permission: vm_prot_t, pager: memory_object_t, entry_handle: [*c]mach_port_t) kern_return_t;
pub extern fn host_statistics(host_priv: host_t, flavor: host_flavor_t, host_info_out: host_info_t, host_info_outCnt: [*c]mach_msg_type_number_t) kern_return_t;
pub extern fn host_request_notification(host: host_t, notify_type: host_flavor_t, notify_port: mach_port_t) kern_return_t;
pub extern fn host_lockgroup_info(host: host_t, lockgroup_info: [*c]lockgroup_info_array_t, lockgroup_infoCnt: [*c]mach_msg_type_number_t) kern_return_t;
pub extern fn host_statistics64(host_priv: host_t, flavor: host_flavor_t, host_info64_out: host_info64_t, host_info64_outCnt: [*c]mach_msg_type_number_t) kern_return_t;
pub extern fn mach_zone_info(host: host_priv_t, names: [*c]mach_zone_name_array_t, namesCnt: [*c]mach_msg_type_number_t, info: [*c]mach_zone_info_array_t, infoCnt: [*c]mach_msg_type_number_t) kern_return_t;
pub extern fn host_create_mach_voucher(host: host_t, recipes: mach_voucher_attr_raw_recipe_array_t, recipesCnt: mach_msg_type_number_t, voucher: [*c]ipc_voucher_t) kern_return_t;
pub extern fn host_register_mach_voucher_attr_manager(host: host_t, attr_manager: mach_voucher_attr_manager_t, default_value: mach_voucher_attr_value_handle_t, new_key: [*c]mach_voucher_attr_key_t, new_attr_control: [*c]ipc_voucher_attr_control_t) kern_return_t;
pub extern fn host_register_well_known_mach_voucher_attr_manager(host: host_t, attr_manager: mach_voucher_attr_manager_t, default_value: mach_voucher_attr_value_handle_t, key: mach_voucher_attr_key_t, new_attr_control: [*c]ipc_voucher_attr_control_t) kern_return_t;
pub extern fn host_set_atm_diagnostic_flag(host: host_t, diagnostic_flag: u32) kern_return_t;
pub extern fn host_get_atm_diagnostic_flag(host: host_t, diagnostic_flag: [*c]u32) kern_return_t;
pub extern fn mach_memory_info(host: host_priv_t, names: [*c]mach_zone_name_array_t, namesCnt: [*c]mach_msg_type_number_t, info: [*c]mach_zone_info_array_t, infoCnt: [*c]mach_msg_type_number_t, memory_info: [*c]mach_memory_info_array_t, memory_infoCnt: [*c]mach_msg_type_number_t) kern_return_t;
pub extern fn host_set_multiuser_config_flags(host_priv: host_priv_t, multiuser_flags: u32) kern_return_t;
pub extern fn host_get_multiuser_config_flags(host: host_t, multiuser_flags: [*c]u32) kern_return_t;
pub extern fn host_check_multiuser_mode(host: host_t, multiuser_mode: [*c]u32) kern_return_t;
pub extern fn mach_zone_info_for_zone(host: host_priv_t, name: mach_zone_name_t, info: [*c]mach_zone_info_t) kern_return_t;
pub const __Request__host_info_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    flavor: host_flavor_t,
    host_info_outCnt: mach_msg_type_number_t,
};
pub const __Request__host_kernel_version_t = extern struct {
    Head: mach_msg_header_t,
};
pub const __Request___host_page_size_t = extern struct {
    Head: mach_msg_header_t,
};
pub const __Request__mach_memory_object_memory_entry_t = extern struct {
    Head: mach_msg_header_t,
    msgh_body: mach_msg_body_t,
    pager: mach_msg_port_descriptor_t,
    NDR: NDR_record_t,
    internal: boolean_t,
    size: vm_size_t,
    permission: vm_prot_t,
};
pub const __Request__host_processor_info_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    flavor: processor_flavor_t,
};
pub const __Request__host_get_io_master_t = extern struct {
    Head: mach_msg_header_t,
};
pub const __Request__host_get_clock_service_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    clock_id: clock_id_t,
};
pub const __Request__kmod_get_info_t = extern struct {
    Head: mach_msg_header_t,
};
pub const __Request__host_virtual_physical_table_info_t = extern struct {
    Head: mach_msg_header_t,
};
pub const __Request__processor_set_default_t = extern struct {
    Head: mach_msg_header_t,
};
pub const __Request__processor_set_create_t = extern struct {
    Head: mach_msg_header_t,
};
pub const __Request__mach_memory_object_memory_entry_64_t = extern struct {
    Head: mach_msg_header_t,
    msgh_body: mach_msg_body_t,
    pager: mach_msg_port_descriptor_t,
    NDR: NDR_record_t,
    internal: boolean_t,
    size: memory_object_size_t,
    permission: vm_prot_t,
};
pub const __Request__host_statistics_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    flavor: host_flavor_t,
    host_info_outCnt: mach_msg_type_number_t,
};
pub const __Request__host_request_notification_t = extern struct {
    Head: mach_msg_header_t,
    msgh_body: mach_msg_body_t,
    notify_port: mach_msg_port_descriptor_t,
    NDR: NDR_record_t,
    notify_type: host_flavor_t,
};
pub const __Request__host_lockgroup_info_t = extern struct {
    Head: mach_msg_header_t,
};
pub const __Request__host_statistics64_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    flavor: host_flavor_t,
    host_info64_outCnt: mach_msg_type_number_t,
};
pub const __Request__mach_zone_info_t = extern struct {
    Head: mach_msg_header_t,
};
pub const __Request__host_create_mach_voucher_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    recipesCnt: mach_msg_type_number_t,
    recipes: [5120]u8,
};
pub const __Request__host_register_mach_voucher_attr_manager_t = extern struct {
    Head: mach_msg_header_t,
    msgh_body: mach_msg_body_t,
    attr_manager: mach_msg_port_descriptor_t,
    NDR: NDR_record_t,
    default_value: mach_voucher_attr_value_handle_t,
};
pub const __Request__host_register_well_known_mach_voucher_attr_manager_t = extern struct {
    Head: mach_msg_header_t,
    msgh_body: mach_msg_body_t,
    attr_manager: mach_msg_port_descriptor_t,
    NDR: NDR_record_t,
    default_value: mach_voucher_attr_value_handle_t,
    key: mach_voucher_attr_key_t,
};
pub const __Request__host_set_atm_diagnostic_flag_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    diagnostic_flag: u32,
};
pub const __Request__host_get_atm_diagnostic_flag_t = extern struct {
    Head: mach_msg_header_t,
};
pub const __Request__mach_memory_info_t = extern struct {
    Head: mach_msg_header_t,
};
pub const __Request__host_set_multiuser_config_flags_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    multiuser_flags: u32,
};
pub const __Request__host_get_multiuser_config_flags_t = extern struct {
    Head: mach_msg_header_t,
};
pub const __Request__host_check_multiuser_mode_t = extern struct {
    Head: mach_msg_header_t,
};
pub const __Request__mach_zone_info_for_zone_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    name: mach_zone_name_t,
};
pub const union___RequestUnion__mach_host_subsystem = extern union {
    Request_host_info: __Request__host_info_t,
    Request_host_kernel_version: __Request__host_kernel_version_t,
    Request__host_page_size: __Request___host_page_size_t,
    Request_mach_memory_object_memory_entry: __Request__mach_memory_object_memory_entry_t,
    Request_host_processor_info: __Request__host_processor_info_t,
    Request_host_get_io_master: __Request__host_get_io_master_t,
    Request_host_get_clock_service: __Request__host_get_clock_service_t,
    Request_kmod_get_info: __Request__kmod_get_info_t,
    Request_host_virtual_physical_table_info: __Request__host_virtual_physical_table_info_t,
    Request_processor_set_default: __Request__processor_set_default_t,
    Request_processor_set_create: __Request__processor_set_create_t,
    Request_mach_memory_object_memory_entry_64: __Request__mach_memory_object_memory_entry_64_t,
    Request_host_statistics: __Request__host_statistics_t,
    Request_host_request_notification: __Request__host_request_notification_t,
    Request_host_lockgroup_info: __Request__host_lockgroup_info_t,
    Request_host_statistics64: __Request__host_statistics64_t,
    Request_mach_zone_info: __Request__mach_zone_info_t,
    Request_host_create_mach_voucher: __Request__host_create_mach_voucher_t,
    Request_host_register_mach_voucher_attr_manager: __Request__host_register_mach_voucher_attr_manager_t,
    Request_host_register_well_known_mach_voucher_attr_manager: __Request__host_register_well_known_mach_voucher_attr_manager_t,
    Request_host_set_atm_diagnostic_flag: __Request__host_set_atm_diagnostic_flag_t,
    Request_host_get_atm_diagnostic_flag: __Request__host_get_atm_diagnostic_flag_t,
    Request_mach_memory_info: __Request__mach_memory_info_t,
    Request_host_set_multiuser_config_flags: __Request__host_set_multiuser_config_flags_t,
    Request_host_get_multiuser_config_flags: __Request__host_get_multiuser_config_flags_t,
    Request_host_check_multiuser_mode: __Request__host_check_multiuser_mode_t,
    Request_mach_zone_info_for_zone: __Request__mach_zone_info_for_zone_t,
};
pub const __Reply__host_info_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
    host_info_outCnt: mach_msg_type_number_t,
    host_info_out: [68]integer_t,
};
pub const __Reply__host_kernel_version_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
    kernel_versionOffset: mach_msg_type_number_t,
    kernel_versionCnt: mach_msg_type_number_t,
    kernel_version: [512]u8,
};
pub const __Reply___host_page_size_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
    out_page_size: vm_size_t,
};
pub const __Reply__mach_memory_object_memory_entry_t = extern struct {
    Head: mach_msg_header_t,
    msgh_body: mach_msg_body_t,
    entry_handle: mach_msg_port_descriptor_t,
};
pub const __Reply__host_processor_info_t = extern struct {
    Head: mach_msg_header_t,
    msgh_body: mach_msg_body_t,
    out_processor_info: mach_msg_ool_descriptor_t,
    NDR: NDR_record_t,
    out_processor_count: natural_t,
    out_processor_infoCnt: mach_msg_type_number_t,
};
pub const __Reply__host_get_io_master_t = extern struct {
    Head: mach_msg_header_t,
    msgh_body: mach_msg_body_t,
    io_master: mach_msg_port_descriptor_t,
};
pub const __Reply__host_get_clock_service_t = extern struct {
    Head: mach_msg_header_t,
    msgh_body: mach_msg_body_t,
    clock_serv: mach_msg_port_descriptor_t,
};
pub const __Reply__kmod_get_info_t = extern struct {
    Head: mach_msg_header_t,
    msgh_body: mach_msg_body_t,
    modules: mach_msg_ool_descriptor_t,
    NDR: NDR_record_t,
    modulesCnt: mach_msg_type_number_t,
};
pub const __Reply__host_virtual_physical_table_info_t = extern struct {
    Head: mach_msg_header_t,
    msgh_body: mach_msg_body_t,
    info: mach_msg_ool_descriptor_t,
    NDR: NDR_record_t,
    infoCnt: mach_msg_type_number_t,
};
pub const __Reply__processor_set_default_t = extern struct {
    Head: mach_msg_header_t,
    msgh_body: mach_msg_body_t,
    default_set: mach_msg_port_descriptor_t,
};
pub const __Reply__processor_set_create_t = extern struct {
    Head: mach_msg_header_t,
    msgh_body: mach_msg_body_t,
    new_set: mach_msg_port_descriptor_t,
    new_name: mach_msg_port_descriptor_t,
};
pub const __Reply__mach_memory_object_memory_entry_64_t = extern struct {
    Head: mach_msg_header_t,
    msgh_body: mach_msg_body_t,
    entry_handle: mach_msg_port_descriptor_t,
};
pub const __Reply__host_statistics_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
    host_info_outCnt: mach_msg_type_number_t,
    host_info_out: [68]integer_t,
};
pub const __Reply__host_request_notification_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
};
pub const __Reply__host_lockgroup_info_t = extern struct {
    Head: mach_msg_header_t,
    msgh_body: mach_msg_body_t,
    lockgroup_info: mach_msg_ool_descriptor_t,
    NDR: NDR_record_t,
    lockgroup_infoCnt: mach_msg_type_number_t,
};
pub const __Reply__host_statistics64_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
    host_info64_outCnt: mach_msg_type_number_t,
    host_info64_out: [256]integer_t,
};
pub const __Reply__mach_zone_info_t = extern struct {
    Head: mach_msg_header_t,
    msgh_body: mach_msg_body_t,
    names: mach_msg_ool_descriptor_t,
    info: mach_msg_ool_descriptor_t,
    NDR: NDR_record_t,
    namesCnt: mach_msg_type_number_t,
    infoCnt: mach_msg_type_number_t,
};
pub const __Reply__host_create_mach_voucher_t = extern struct {
    Head: mach_msg_header_t,
    msgh_body: mach_msg_body_t,
    voucher: mach_msg_port_descriptor_t,
};
pub const __Reply__host_register_mach_voucher_attr_manager_t = extern struct {
    Head: mach_msg_header_t,
    msgh_body: mach_msg_body_t,
    new_attr_control: mach_msg_port_descriptor_t,
    NDR: NDR_record_t,
    new_key: mach_voucher_attr_key_t,
};
pub const __Reply__host_register_well_known_mach_voucher_attr_manager_t = extern struct {
    Head: mach_msg_header_t,
    msgh_body: mach_msg_body_t,
    new_attr_control: mach_msg_port_descriptor_t,
};
pub const __Reply__host_set_atm_diagnostic_flag_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
};
pub const __Reply__host_get_atm_diagnostic_flag_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
    diagnostic_flag: u32,
};
pub const __Reply__mach_memory_info_t = extern struct {
    Head: mach_msg_header_t,
    msgh_body: mach_msg_body_t,
    names: mach_msg_ool_descriptor_t,
    info: mach_msg_ool_descriptor_t,
    memory_info: mach_msg_ool_descriptor_t,
    NDR: NDR_record_t,
    namesCnt: mach_msg_type_number_t,
    infoCnt: mach_msg_type_number_t,
    memory_infoCnt: mach_msg_type_number_t,
};
pub const __Reply__host_set_multiuser_config_flags_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
};
pub const __Reply__host_get_multiuser_config_flags_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
    multiuser_flags: u32,
};
pub const __Reply__host_check_multiuser_mode_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
    multiuser_mode: u32,
};
pub const __Reply__mach_zone_info_for_zone_t = extern struct {
    Head: mach_msg_header_t,
    NDR: NDR_record_t,
    RetCode: kern_return_t,
    info: mach_zone_info_t,
};
pub const union___ReplyUnion__mach_host_subsystem = extern union {
    Reply_host_info: __Reply__host_info_t,
    Reply_host_kernel_version: __Reply__host_kernel_version_t,
    Reply__host_page_size: __Reply___host_page_size_t,
    Reply_mach_memory_object_memory_entry: __Reply__mach_memory_object_memory_entry_t,
    Reply_host_processor_info: __Reply__host_processor_info_t,
    Reply_host_get_io_master: __Reply__host_get_io_master_t,
    Reply_host_get_clock_service: __Reply__host_get_clock_service_t,
    Reply_kmod_get_info: __Reply__kmod_get_info_t,
    Reply_host_virtual_physical_table_info: __Reply__host_virtual_physical_table_info_t,
    Reply_processor_set_default: __Reply__processor_set_default_t,
    Reply_processor_set_create: __Reply__processor_set_create_t,
    Reply_mach_memory_object_memory_entry_64: __Reply__mach_memory_object_memory_entry_64_t,
    Reply_host_statistics: __Reply__host_statistics_t,
    Reply_host_request_notification: __Reply__host_request_notification_t,
    Reply_host_lockgroup_info: __Reply__host_lockgroup_info_t,
    Reply_host_statistics64: __Reply__host_statistics64_t,
    Reply_mach_zone_info: __Reply__mach_zone_info_t,
    Reply_host_create_mach_voucher: __Reply__host_create_mach_voucher_t,
    Reply_host_register_mach_voucher_attr_manager: __Reply__host_register_mach_voucher_attr_manager_t,
    Reply_host_register_well_known_mach_voucher_attr_manager: __Reply__host_register_well_known_mach_voucher_attr_manager_t,
    Reply_host_set_atm_diagnostic_flag: __Reply__host_set_atm_diagnostic_flag_t,
    Reply_host_get_atm_diagnostic_flag: __Reply__host_get_atm_diagnostic_flag_t,
    Reply_mach_memory_info: __Reply__mach_memory_info_t,
    Reply_host_set_multiuser_config_flags: __Reply__host_set_multiuser_config_flags_t,
    Reply_host_get_multiuser_config_flags: __Reply__host_get_multiuser_config_flags_t,
    Reply_host_check_multiuser_mode: __Reply__host_check_multiuser_mode_t,
    Reply_mach_zone_info_for_zone: __Reply__mach_zone_info_for_zone_t,
};
pub const routine_arg_type = c_uint;
pub const routine_arg_offset = c_uint;
pub const routine_arg_size = c_uint;
pub const struct_rpc_routine_arg_descriptor = extern struct {
    type: routine_arg_type,
    size: routine_arg_size,
    count: routine_arg_size,
    offset: routine_arg_offset,
};
pub const rpc_routine_arg_descriptor_t = [*c]struct_rpc_routine_arg_descriptor;
pub const struct_rpc_routine_descriptor = extern struct {
    impl_routine: mig_impl_routine_t,
    stub_routine: mig_stub_routine_t,
    argc: c_uint,
    descr_count: c_uint,
    arg_descr: rpc_routine_arg_descriptor_t,
    max_reply_msg: c_uint,
};
pub const rpc_routine_descriptor_t = [*c]struct_rpc_routine_descriptor;
pub const struct_rpc_signature = extern struct {
    rd: struct_rpc_routine_descriptor,
    rad: [1]struct_rpc_routine_arg_descriptor,
};
pub const struct_rpc_subsystem = extern struct {
    reserved: ?*anyopaque,
    start: mach_msg_id_t,
    end: mach_msg_id_t,
    maxsize: c_uint,
    base_addr: vm_address_t,
    routine: [1]struct_rpc_routine_descriptor,
    arg_descriptor: [1]struct_rpc_routine_arg_descriptor,
};
pub const rpc_subsystem_t = [*c]struct_rpc_subsystem;
pub const mach_error_t = kern_return_t;
pub const mach_error_fn_t = ?fn () callconv(.C) mach_error_t;
pub extern fn mach_error_string(error_value: mach_error_t) [*c]u8;
pub extern fn mach_error(str: [*c]const u8, error_value: mach_error_t) void;
pub extern fn mach_error_type(error_value: mach_error_t) [*c]u8;
pub extern fn panic_init(mach_port_t) void;
pub extern fn panic([*c]const u8, ...) void;
pub extern fn slot_name(cpu_type_t, cpu_subtype_t, [*c][*c]u8, [*c][*c]u8) void;
pub extern fn mig_reply_setup([*c]mach_msg_header_t, [*c]mach_msg_header_t) void;
pub extern fn mach_msg_destroy([*c]mach_msg_header_t) void;
pub extern fn mach_msg_receive([*c]mach_msg_header_t) mach_msg_return_t;
pub extern fn mach_msg_send([*c]mach_msg_header_t) mach_msg_return_t;
pub extern fn mach_msg_server_once(?fn ([*c]mach_msg_header_t, [*c]mach_msg_header_t) callconv(.C) boolean_t, mach_msg_size_t, mach_port_t, mach_msg_options_t) mach_msg_return_t;
pub extern fn mach_msg_server(?fn ([*c]mach_msg_header_t, [*c]mach_msg_header_t) callconv(.C) boolean_t, mach_msg_size_t, mach_port_t, mach_msg_options_t) mach_msg_return_t;
pub extern fn mach_msg_server_importance(?fn ([*c]mach_msg_header_t, [*c]mach_msg_header_t) callconv(.C) boolean_t, mach_msg_size_t, mach_port_t, mach_msg_options_t) mach_msg_return_t;
pub extern fn clock_get_res(mach_port_t, [*c]clock_res_t) kern_return_t;
pub extern fn clock_set_res(mach_port_t, clock_res_t) kern_return_t;
pub extern fn clock_sleep(mach_port_t, c_int, mach_timespec_t, [*c]mach_timespec_t) kern_return_t;
pub const struct_voucher_mach_msg_state_s = opaque {};
pub const voucher_mach_msg_state_t = ?*struct_voucher_mach_msg_state_s;
pub extern fn voucher_mach_msg_set(msg: [*c]mach_msg_header_t) boolean_t;
pub extern fn voucher_mach_msg_clear(msg: [*c]mach_msg_header_t) void;
pub extern fn voucher_mach_msg_adopt(msg: [*c]mach_msg_header_t) voucher_mach_msg_state_t;
pub extern fn voucher_mach_msg_revert(state: voucher_mach_msg_state_t) void;
pub const KERN_SUCCESS = @as(c_int, 0);
pub const KERN_INVALID_ADDRESS = @as(c_int, 1);
pub const KERN_PROTECTION_FAILURE = @as(c_int, 2);
pub const KERN_NO_SPACE = @as(c_int, 3);
pub const KERN_INVALID_ARGUMENT = @as(c_int, 4);
pub const KERN_FAILURE = @as(c_int, 5);
pub const KERN_RESOURCE_SHORTAGE = @as(c_int, 6);
pub const KERN_NOT_RECEIVER = @as(c_int, 7);
pub const KERN_NO_ACCESS = @as(c_int, 8);
pub const KERN_MEMORY_FAILURE = @as(c_int, 9);
pub const KERN_MEMORY_ERROR = @as(c_int, 10);
pub const KERN_ALREADY_IN_SET = @as(c_int, 11);
pub const KERN_NOT_IN_SET = @as(c_int, 12);
pub const KERN_NAME_EXISTS = @as(c_int, 13);
pub const KERN_ABORTED = @as(c_int, 14);
pub const KERN_INVALID_NAME = @as(c_int, 15);
pub const KERN_INVALID_TASK = @as(c_int, 16);
pub const KERN_INVALID_RIGHT = @as(c_int, 17);
pub const KERN_INVALID_VALUE = @as(c_int, 18);
pub const KERN_UREFS_OVERFLOW = @as(c_int, 19);
pub const KERN_INVALID_CAPABILITY = @as(c_int, 20);
pub const KERN_RIGHT_EXISTS = @as(c_int, 21);
pub const KERN_INVALID_HOST = @as(c_int, 22);
pub const KERN_MEMORY_PRESENT = @as(c_int, 23);
pub const KERN_MEMORY_DATA_MOVED = @as(c_int, 24);
pub const KERN_MEMORY_RESTART_COPY = @as(c_int, 25);
pub const KERN_INVALID_PROCESSOR_SET = @as(c_int, 26);
pub const KERN_POLICY_LIMIT = @as(c_int, 27);
pub const KERN_INVALID_POLICY = @as(c_int, 28);
pub const KERN_INVALID_OBJECT = @as(c_int, 29);
pub const KERN_ALREADY_WAITING = @as(c_int, 30);
pub const KERN_DEFAULT_SET = @as(c_int, 31);
pub const KERN_EXCEPTION_PROTECTED = @as(c_int, 32);
pub const KERN_INVALID_LEDGER = @as(c_int, 33);
pub const KERN_INVALID_MEMORY_CONTROL = @as(c_int, 34);
pub const KERN_INVALID_SECURITY = @as(c_int, 35);
pub const KERN_NOT_DEPRESSED = @as(c_int, 36);
pub const KERN_TERMINATED = @as(c_int, 37);
pub const KERN_LOCK_SET_DESTROYED = @as(c_int, 38);
pub const KERN_LOCK_UNSTABLE = @as(c_int, 39);
pub const KERN_LOCK_OWNED = @as(c_int, 40);
pub const KERN_LOCK_OWNED_SELF = @as(c_int, 41);
pub const KERN_SEMAPHORE_DESTROYED = @as(c_int, 42);
pub const KERN_RPC_SERVER_TERMINATED = @as(c_int, 43);
pub const KERN_RPC_TERMINATE_ORPHAN = @as(c_int, 44);
pub const KERN_RPC_CONTINUE_ORPHAN = @as(c_int, 45);
pub const KERN_NOT_SUPPORTED = @as(c_int, 46);
pub const KERN_NODE_DOWN = @as(c_int, 47);
pub const KERN_NOT_WAITING = @as(c_int, 48);
pub const KERN_OPERATION_TIMED_OUT = @as(c_int, 49);
pub const KERN_CODESIGN_ERROR = @as(c_int, 50);
pub const KERN_POLICY_STATIC = @as(c_int, 51);
pub const KERN_INSUFFICIENT_BUFFER_SIZE = @as(c_int, 52);
pub const KERN_DENIED = @as(c_int, 53);
pub const KERN_MISSING_KC = @as(c_int, 54);
pub const KERN_INVALID_KC = @as(c_int, 55);
pub const KERN_NOT_FOUND = @as(c_int, 56);
pub const KERN_RETURN_MAX = @as(c_int, 0x100);
pub const MACH_PORT_NULL = @as(c_int, 0);
pub const MACH_PORT_DEAD = @import("std").zig.c_translation.cast(mach_port_name_t, ~@as(c_int, 0));
pub inline fn MACH_PORT_VALID(name: anytype) @TypeOf((name != MACH_PORT_NULL) and (name != MACH_PORT_DEAD)) {
    return (name != MACH_PORT_NULL) and (name != MACH_PORT_DEAD);
}
pub inline fn MACH_PORT_INDEX(name: anytype) @TypeOf(name >> @as(c_int, 8)) {
    return name >> @as(c_int, 8);
}
pub inline fn MACH_PORT_GEN(name: anytype) @TypeOf((name & @as(c_int, 0xff)) << @as(c_int, 24)) {
    return (name & @as(c_int, 0xff)) << @as(c_int, 24);
}
pub inline fn MACH_PORT_MAKE(index_1: anytype, gen: anytype) @TypeOf((index_1 << @as(c_int, 8)) | (gen >> @as(c_int, 24))) {
    return (index_1 << @as(c_int, 8)) | (gen >> @as(c_int, 24));
}
pub const MACH_PORT_RIGHT_SEND = @import("std").zig.c_translation.cast(mach_port_right_t, @as(c_int, 0));
pub const MACH_PORT_RIGHT_RECEIVE = @import("std").zig.c_translation.cast(mach_port_right_t, @as(c_int, 1));
pub const MACH_PORT_RIGHT_SEND_ONCE = @import("std").zig.c_translation.cast(mach_port_right_t, @as(c_int, 2));
pub const MACH_PORT_RIGHT_PORT_SET = @import("std").zig.c_translation.cast(mach_port_right_t, @as(c_int, 3));
pub const MACH_PORT_RIGHT_DEAD_NAME = @import("std").zig.c_translation.cast(mach_port_right_t, @as(c_int, 4));
pub const MACH_PORT_RIGHT_LABELH = @import("std").zig.c_translation.cast(mach_port_right_t, @as(c_int, 5));
pub const MACH_PORT_RIGHT_NUMBER = @import("std").zig.c_translation.cast(mach_port_right_t, @as(c_int, 6));
pub inline fn MACH_PORT_TYPE(right: anytype) mach_port_type_t {
    return @import("std").zig.c_translation.cast(mach_port_type_t, @import("std").zig.c_translation.cast(mach_port_type_t, @as(c_int, 1)) << (right + @import("std").zig.c_translation.cast(mach_port_right_t, @as(c_int, 16))));
}
pub const MACH_PORT_TYPE_NONE = @import("std").zig.c_translation.cast(mach_port_type_t, @as(c_long, 0));
pub const MACH_PORT_TYPE_SEND = MACH_PORT_TYPE(MACH_PORT_RIGHT_SEND);
pub const MACH_PORT_TYPE_RECEIVE = MACH_PORT_TYPE(MACH_PORT_RIGHT_RECEIVE);
pub const MACH_PORT_TYPE_SEND_ONCE = MACH_PORT_TYPE(MACH_PORT_RIGHT_SEND_ONCE);
pub const MACH_PORT_TYPE_PORT_SET = MACH_PORT_TYPE(MACH_PORT_RIGHT_PORT_SET);
pub const MACH_PORT_TYPE_DEAD_NAME = MACH_PORT_TYPE(MACH_PORT_RIGHT_DEAD_NAME);
pub const MACH_PORT_TYPE_LABELH = MACH_PORT_TYPE(MACH_PORT_RIGHT_LABELH);
pub const MACH_PORT_TYPE_SEND_RECEIVE = MACH_PORT_TYPE_SEND | MACH_PORT_TYPE_RECEIVE;
pub const MACH_PORT_TYPE_SEND_RIGHTS = MACH_PORT_TYPE_SEND | MACH_PORT_TYPE_SEND_ONCE;
pub const MACH_PORT_TYPE_PORT_RIGHTS = MACH_PORT_TYPE_SEND_RIGHTS | MACH_PORT_TYPE_RECEIVE;
pub const MACH_PORT_TYPE_PORT_OR_DEAD = MACH_PORT_TYPE_PORT_RIGHTS | MACH_PORT_TYPE_DEAD_NAME;
pub const MACH_PORT_TYPE_ALL_RIGHTS = MACH_PORT_TYPE_PORT_OR_DEAD | MACH_PORT_TYPE_PORT_SET;
pub const MACH_PORT_TYPE_DNREQUEST = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x80000000, .hexadecimal);
pub const MACH_PORT_TYPE_SPREQUEST = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x40000000, .hexadecimal);
pub const MACH_PORT_TYPE_SPREQUEST_DELAYED = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x20000000, .hexadecimal);
pub const MACH_PORT_SRIGHTS_NONE = @as(c_int, 0);
pub const MACH_PORT_SRIGHTS_PRESENT = @as(c_int, 1);
pub const MACH_PORT_QLIMIT_ZERO = @as(c_int, 0);
pub const MACH_PORT_QLIMIT_BASIC = @as(c_int, 5);
pub const MACH_PORT_QLIMIT_SMALL = @as(c_int, 16);
pub const MACH_PORT_QLIMIT_LARGE = @as(c_int, 1024);
pub const MACH_PORT_QLIMIT_KERNEL = @import("std").zig.c_translation.promoteIntLiteral(c_int, 65534, .decimal);
pub const MACH_PORT_QLIMIT_MIN = MACH_PORT_QLIMIT_ZERO;
pub const MACH_PORT_QLIMIT_DEFAULT = MACH_PORT_QLIMIT_BASIC;
pub const MACH_PORT_QLIMIT_MAX = MACH_PORT_QLIMIT_LARGE;
pub const MACH_PORT_STATUS_FLAG_TEMPOWNER = @as(c_int, 0x01);
pub const MACH_PORT_STATUS_FLAG_GUARDED = @as(c_int, 0x02);
pub const MACH_PORT_STATUS_FLAG_STRICT_GUARD = @as(c_int, 0x04);
pub const MACH_PORT_STATUS_FLAG_IMP_DONATION = @as(c_int, 0x08);
pub const MACH_PORT_STATUS_FLAG_REVIVE = @as(c_int, 0x10);
pub const MACH_PORT_STATUS_FLAG_TASKPTR = @as(c_int, 0x20);
pub const MACH_PORT_STATUS_FLAG_GUARD_IMMOVABLE_RECEIVE = @as(c_int, 0x40);
pub const MACH_PORT_STATUS_FLAG_NO_GRANT = @as(c_int, 0x80);
pub const MACH_PORT_LIMITS_INFO = @as(c_int, 1);
pub const MACH_PORT_RECEIVE_STATUS = @as(c_int, 2);
pub const MACH_PORT_DNREQUESTS_SIZE = @as(c_int, 3);
pub const MACH_PORT_TEMPOWNER = @as(c_int, 4);
pub const MACH_PORT_IMPORTANCE_RECEIVER = @as(c_int, 5);
pub const MACH_PORT_DENAP_RECEIVER = @as(c_int, 6);
pub const MACH_PORT_INFO_EXT = @as(c_int, 7);
pub const MACH_PORT_GUARD_INFO = @as(c_int, 8);
pub const MACH_PORT_LIMITS_INFO_COUNT = @import("std").zig.c_translation.cast(natural_t, @import("std").zig.c_translation.sizeof(mach_port_limits_t) / @import("std").zig.c_translation.sizeof(natural_t));
pub const MACH_PORT_RECEIVE_STATUS_COUNT = @import("std").zig.c_translation.cast(natural_t, @import("std").zig.c_translation.sizeof(mach_port_status_t) / @import("std").zig.c_translation.sizeof(natural_t));
pub const MACH_PORT_DNREQUESTS_SIZE_COUNT = @as(c_int, 1);
pub const MACH_PORT_INFO_EXT_COUNT = @import("std").zig.c_translation.cast(natural_t, @import("std").zig.c_translation.sizeof(mach_port_info_ext_t) / @import("std").zig.c_translation.sizeof(natural_t));
pub const MACH_PORT_GUARD_INFO_COUNT = @import("std").zig.c_translation.cast(natural_t, @import("std").zig.c_translation.sizeof(mach_port_guard_info_t) / @import("std").zig.c_translation.sizeof(natural_t));
pub const MACH_SERVICE_PORT_INFO_STRING_NAME_MAX_BUF_LEN = @as(c_int, 255);
pub const MACH_SERVICE_PORT_INFO_COUNT = @import("std").zig.c_translation.cast(u8, @import("std").zig.c_translation.sizeof(mach_service_port_info_data_t) / @import("std").zig.c_translation.sizeof(u8));
pub const MPO_CONTEXT_AS_GUARD = @as(c_int, 0x01);
pub const MPO_QLIMIT = @as(c_int, 0x02);
pub const MPO_TEMPOWNER = @as(c_int, 0x04);
pub const MPO_IMPORTANCE_RECEIVER = @as(c_int, 0x08);
pub const MPO_INSERT_SEND_RIGHT = @as(c_int, 0x10);
pub const MPO_STRICT = @as(c_int, 0x20);
pub const MPO_DENAP_RECEIVER = @as(c_int, 0x40);
pub const MPO_IMMOVABLE_RECEIVE = @as(c_int, 0x80);
pub const MPO_FILTER_MSG = @as(c_int, 0x100);
pub const MPO_TG_BLOCK_TRACKING = @as(c_int, 0x200);
pub const MPO_SERVICE_PORT = @as(c_int, 0x400);
pub const MPO_CONNECTION_PORT = @as(c_int, 0x800);
pub const GUARD_TYPE_MACH_PORT = @as(c_int, 0x1);
pub const MAX_FATAL_kGUARD_EXC_CODE = @as(c_uint, 1) << @as(c_int, 7);
pub const MPG_FLAGS_NONE = @as(c_ulonglong, 0x00);
pub const MAX_OPTIONAL_kGUARD_EXC_CODE = @as(c_uint, 1) << @as(c_int, 19);
pub const MPG_FLAGS_STRICT_REPLY_INVALID_REPLY_DISP = @as(c_ulonglong, 0x01) << @as(c_int, 56);
pub const MPG_FLAGS_STRICT_REPLY_INVALID_REPLY_PORT = @as(c_ulonglong, 0x02) << @as(c_int, 56);
pub const MPG_FLAGS_STRICT_REPLY_INVALID_VOUCHER = @as(c_ulonglong, 0x04) << @as(c_int, 56);
pub const MPG_FLAGS_STRICT_REPLY_NO_BANK_ATTR = @as(c_ulonglong, 0x08) << @as(c_int, 56);
pub const MPG_FLAGS_STRICT_REPLY_MISMATCHED_PERSONA = @as(c_ulonglong, 0x10) << @as(c_int, 56);
pub const MPG_FLAGS_STRICT_REPLY_MASK = @as(c_ulonglong, 0xff) << @as(c_int, 56);
pub const MPG_FLAGS_MOD_REFS_PINNED_DEALLOC = @as(c_ulonglong, 0x01) << @as(c_int, 56);
pub const MPG_FLAGS_MOD_REFS_PINNED_DESTROY = @as(c_ulonglong, 0x02) << @as(c_int, 56);
pub const MPG_FLAGS_MOD_REFS_PINNED_COPYIN = @as(c_ulonglong, 0x04) << @as(c_int, 56);
pub const MPG_FLAGS_IMMOVABLE_PINNED = @as(c_ulonglong, 0x01) << @as(c_int, 56);
pub const MPG_STRICT = @as(c_int, 0x01);
pub const MPG_IMMOVABLE_RECEIVE = @as(c_int, 0x02);
pub const _MACH_VM_TYPES_H_ = "";
pub const VM_MAP_NULL = @import("std").zig.c_translation.cast(vm_map_t, @as(c_int, 0));
pub const VM_MAP_INSPECT_NULL = @import("std").zig.c_translation.cast(vm_map_inspect_t, @as(c_int, 0));
pub const VM_MAP_READ_NULL = @import("std").zig.c_translation.cast(vm_map_read_t, @as(c_int, 0));
pub const UPL_NULL = @import("std").zig.c_translation.cast(upl_t, @as(c_int, 0));
pub const VM_NAMED_ENTRY_NULL = @import("std").zig.c_translation.cast(vm_named_entry_t, @as(c_int, 0));
pub const MACH_MSG_TIMEOUT_NONE = @import("std").zig.c_translation.cast(mach_msg_timeout_t, @as(c_int, 0));
pub const MACH_MSGH_BITS_ZERO = @as(c_int, 0x00000000);
pub const MACH_MSGH_BITS_REMOTE_MASK = @as(c_int, 0x0000001f);
pub const MACH_MSGH_BITS_LOCAL_MASK = @as(c_int, 0x00001f00);
pub const MACH_MSGH_BITS_VOUCHER_MASK = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x001f0000, .hexadecimal);
pub const MACH_MSGH_BITS_PORTS_MASK = (MACH_MSGH_BITS_REMOTE_MASK | MACH_MSGH_BITS_LOCAL_MASK) | MACH_MSGH_BITS_VOUCHER_MASK;
pub const MACH_MSGH_BITS_COMPLEX = @import("std").zig.c_translation.promoteIntLiteral(c_uint, 0x80000000, .hexadecimal);
pub const MACH_MSGH_BITS_USER = @import("std").zig.c_translation.promoteIntLiteral(c_uint, 0x801f1f1f, .hexadecimal);
pub const MACH_MSGH_BITS_RAISEIMP = @import("std").zig.c_translation.promoteIntLiteral(c_uint, 0x20000000, .hexadecimal);
pub const MACH_MSGH_BITS_DENAP = MACH_MSGH_BITS_RAISEIMP;
pub const MACH_MSGH_BITS_IMPHOLDASRT = @import("std").zig.c_translation.promoteIntLiteral(c_uint, 0x10000000, .hexadecimal);
pub const MACH_MSGH_BITS_DENAPHOLDASRT = MACH_MSGH_BITS_IMPHOLDASRT;
pub const MACH_MSGH_BITS_CIRCULAR = @import("std").zig.c_translation.promoteIntLiteral(c_uint, 0x10000000, .hexadecimal);
pub const MACH_MSGH_BITS_USED = @import("std").zig.c_translation.promoteIntLiteral(c_uint, 0xb01f1f1f, .hexadecimal);
pub inline fn MACH_MSGH_BITS(remote: anytype, local: anytype) @TypeOf(remote | (local << @as(c_int, 8))) {
    return remote | (local << @as(c_int, 8));
}
pub inline fn MACH_MSGH_BITS_SET_PORTS(remote: anytype, local: anytype, voucher: anytype) @TypeOf(((remote & MACH_MSGH_BITS_REMOTE_MASK) | ((local << @as(c_int, 8)) & MACH_MSGH_BITS_LOCAL_MASK)) | ((voucher << @as(c_int, 16)) & MACH_MSGH_BITS_VOUCHER_MASK)) {
    return ((remote & MACH_MSGH_BITS_REMOTE_MASK) | ((local << @as(c_int, 8)) & MACH_MSGH_BITS_LOCAL_MASK)) | ((voucher << @as(c_int, 16)) & MACH_MSGH_BITS_VOUCHER_MASK);
}
pub inline fn MACH_MSGH_BITS_SET(remote: anytype, local: anytype, voucher: anytype, other: anytype) @TypeOf(MACH_MSGH_BITS_SET_PORTS(remote, local, voucher) | (other & ~MACH_MSGH_BITS_PORTS_MASK)) {
    return MACH_MSGH_BITS_SET_PORTS(remote, local, voucher) | (other & ~MACH_MSGH_BITS_PORTS_MASK);
}
pub inline fn MACH_MSGH_BITS_REMOTE(bits: anytype) @TypeOf(bits & MACH_MSGH_BITS_REMOTE_MASK) {
    return bits & MACH_MSGH_BITS_REMOTE_MASK;
}
pub inline fn MACH_MSGH_BITS_LOCAL(bits: anytype) @TypeOf((bits & MACH_MSGH_BITS_LOCAL_MASK) >> @as(c_int, 8)) {
    return (bits & MACH_MSGH_BITS_LOCAL_MASK) >> @as(c_int, 8);
}
pub inline fn MACH_MSGH_BITS_VOUCHER(bits: anytype) @TypeOf((bits & MACH_MSGH_BITS_VOUCHER_MASK) >> @as(c_int, 16)) {
    return (bits & MACH_MSGH_BITS_VOUCHER_MASK) >> @as(c_int, 16);
}
pub inline fn MACH_MSGH_BITS_PORTS(bits: anytype) @TypeOf(bits & MACH_MSGH_BITS_PORTS_MASK) {
    return bits & MACH_MSGH_BITS_PORTS_MASK;
}
pub inline fn MACH_MSGH_BITS_OTHER(bits: anytype) @TypeOf(bits & ~MACH_MSGH_BITS_PORTS_MASK) {
    return bits & ~MACH_MSGH_BITS_PORTS_MASK;
}
pub inline fn MACH_MSGH_BITS_HAS_REMOTE(bits: anytype) @TypeOf(MACH_MSGH_BITS_REMOTE(bits) != MACH_MSGH_BITS_ZERO) {
    return MACH_MSGH_BITS_REMOTE(bits) != MACH_MSGH_BITS_ZERO;
}
pub inline fn MACH_MSGH_BITS_HAS_LOCAL(bits: anytype) @TypeOf(MACH_MSGH_BITS_LOCAL(bits) != MACH_MSGH_BITS_ZERO) {
    return MACH_MSGH_BITS_LOCAL(bits) != MACH_MSGH_BITS_ZERO;
}
pub inline fn MACH_MSGH_BITS_HAS_VOUCHER(bits: anytype) @TypeOf(MACH_MSGH_BITS_VOUCHER(bits) != MACH_MSGH_BITS_ZERO) {
    return MACH_MSGH_BITS_VOUCHER(bits) != MACH_MSGH_BITS_ZERO;
}
pub inline fn MACH_MSGH_BITS_IS_COMPLEX(bits: anytype) @TypeOf((bits & MACH_MSGH_BITS_COMPLEX) != MACH_MSGH_BITS_ZERO) {
    return (bits & MACH_MSGH_BITS_COMPLEX) != MACH_MSGH_BITS_ZERO;
}
pub inline fn MACH_MSGH_BITS_RAISED_IMPORTANCE(bits: anytype) @TypeOf((bits & MACH_MSGH_BITS_RAISEIMP) != MACH_MSGH_BITS_ZERO) {
    return (bits & MACH_MSGH_BITS_RAISEIMP) != MACH_MSGH_BITS_ZERO;
}
pub inline fn MACH_MSGH_BITS_HOLDS_IMPORTANCE_ASSERTION(bits: anytype) @TypeOf((bits & MACH_MSGH_BITS_IMPHOLDASRT) != MACH_MSGH_BITS_ZERO) {
    return (bits & MACH_MSGH_BITS_IMPHOLDASRT) != MACH_MSGH_BITS_ZERO;
}
pub const MACH_MSG_SIZE_NULL = @import("std").zig.c_translation.cast([*c]mach_msg_size_t, @as(c_int, 0));
pub const MACH_MSG_PRIORITY_UNSPECIFIED = @import("std").zig.c_translation.cast(mach_msg_priority_t, @as(c_int, 0));
pub const MACH_MSG_TYPE_MOVE_RECEIVE = @as(c_int, 16);
pub const MACH_MSG_TYPE_MOVE_SEND = @as(c_int, 17);
pub const MACH_MSG_TYPE_MOVE_SEND_ONCE = @as(c_int, 18);
pub const MACH_MSG_TYPE_COPY_SEND = @as(c_int, 19);
pub const MACH_MSG_TYPE_MAKE_SEND = @as(c_int, 20);
pub const MACH_MSG_TYPE_MAKE_SEND_ONCE = @as(c_int, 21);
pub const MACH_MSG_TYPE_COPY_RECEIVE = @as(c_int, 22);
pub const MACH_MSG_TYPE_DISPOSE_RECEIVE = @as(c_int, 24);
pub const MACH_MSG_TYPE_DISPOSE_SEND = @as(c_int, 25);
pub const MACH_MSG_TYPE_DISPOSE_SEND_ONCE = @as(c_int, 26);
pub const MACH_MSG_PHYSICAL_COPY = @as(c_int, 0);
pub const MACH_MSG_VIRTUAL_COPY = @as(c_int, 1);
pub const MACH_MSG_ALLOCATE = @as(c_int, 2);
pub const MACH_MSG_OVERWRITE = @as(c_int, 3);
pub const MACH_MSG_GUARD_FLAGS_NONE = @as(c_int, 0x0000);
pub const MACH_MSG_GUARD_FLAGS_IMMOVABLE_RECEIVE = @as(c_int, 0x0001);
pub const MACH_MSG_GUARD_FLAGS_UNGUARDED_ON_SEND = @as(c_int, 0x0002);
pub const MACH_MSG_GUARD_FLAGS_MASK = @as(c_int, 0x0003);
pub const MACH_MSG_PORT_DESCRIPTOR = @as(c_int, 0);
pub const MACH_MSG_OOL_DESCRIPTOR = @as(c_int, 1);
pub const MACH_MSG_OOL_PORTS_DESCRIPTOR = @as(c_int, 2);
pub const MACH_MSG_OOL_VOLATILE_DESCRIPTOR = @as(c_int, 3);
pub const MACH_MSG_GUARDED_PORT_DESCRIPTOR = @as(c_int, 4);
pub const MACH_MSG_BODY_NULL = @import("std").zig.c_translation.cast([*c]mach_msg_body_t, @as(c_int, 0));
pub const MACH_MSG_DESCRIPTOR_NULL = @import("std").zig.c_translation.cast([*c]mach_msg_descriptor_t, @as(c_int, 0));
pub const MACH_MSG_NULL = @import("std").zig.c_translation.cast([*c]mach_msg_header_t, @as(c_int, 0));
pub const MACH_MSG_TRAILER_FORMAT_0 = @as(c_int, 0);
pub const MACH_MSG_FILTER_POLICY_ALLOW = @import("std").zig.c_translation.cast(mach_msg_filter_id, @as(c_int, 0));
pub const MACH_MSG_TRAILER_MINIMUM_SIZE = @import("std").zig.c_translation.sizeof(mach_msg_trailer_t);
pub const MAX_TRAILER_SIZE = @import("std").zig.c_translation.cast(mach_msg_size_t, @import("std").zig.c_translation.sizeof(mach_msg_max_trailer_t));
pub const MACH_MSG_TRAILER_FORMAT_0_SIZE = @import("std").zig.c_translation.sizeof(mach_msg_format_0_trailer_t);
pub inline fn round_msg(x: anytype) @TypeOf(((@import("std").zig.c_translation.cast(mach_msg_size_t, x) + @import("std").zig.c_translation.sizeof(natural_t)) - @as(c_int, 1)) & ~(@import("std").zig.c_translation.sizeof(natural_t) - @as(c_int, 1))) {
    return ((@import("std").zig.c_translation.cast(mach_msg_size_t, x) + @import("std").zig.c_translation.sizeof(natural_t)) - @as(c_int, 1)) & ~(@import("std").zig.c_translation.sizeof(natural_t) - @as(c_int, 1));
}
pub const MACH_MSG_SIZE_MAX = @import("std").zig.c_translation.cast(mach_msg_size_t, ~@as(c_int, 0));
pub const MACH_MSG_SIZE_RELIABLE = @import("std").zig.c_translation.cast(mach_msg_size_t, @as(c_int, 256)) * @as(c_int, 1024);
pub const MACH_MSGH_KIND_NORMAL = @as(c_int, 0x00000000);
pub const MACH_MSGH_KIND_NOTIFICATION = @as(c_int, 0x00000001);
pub const mach_msg_kind_t = mach_port_seqno_t;
pub const MACH_MSG_TYPE_PORT_NONE = @as(c_int, 0);
pub const MACH_MSG_TYPE_PORT_NAME = @as(c_int, 15);
pub const MACH_MSG_TYPE_PORT_RECEIVE = MACH_MSG_TYPE_MOVE_RECEIVE;
pub const MACH_MSG_TYPE_PORT_SEND = MACH_MSG_TYPE_MOVE_SEND;
pub const MACH_MSG_TYPE_PORT_SEND_ONCE = MACH_MSG_TYPE_MOVE_SEND_ONCE;
pub const MACH_MSG_TYPE_LAST = @as(c_int, 22);
pub const MACH_MSG_TYPE_POLYMORPHIC = @import("std").zig.c_translation.cast(mach_msg_type_name_t, -@as(c_int, 1));
pub inline fn MACH_MSG_TYPE_PORT_ANY(x: anytype) @TypeOf((x >= MACH_MSG_TYPE_MOVE_RECEIVE) and (x <= MACH_MSG_TYPE_MAKE_SEND_ONCE)) {
    return (x >= MACH_MSG_TYPE_MOVE_RECEIVE) and (x <= MACH_MSG_TYPE_MAKE_SEND_ONCE);
}
pub inline fn MACH_MSG_TYPE_PORT_ANY_SEND(x: anytype) @TypeOf((x >= MACH_MSG_TYPE_MOVE_SEND) and (x <= MACH_MSG_TYPE_MAKE_SEND_ONCE)) {
    return (x >= MACH_MSG_TYPE_MOVE_SEND) and (x <= MACH_MSG_TYPE_MAKE_SEND_ONCE);
}
pub inline fn MACH_MSG_TYPE_PORT_ANY_RIGHT(x: anytype) @TypeOf((x >= MACH_MSG_TYPE_MOVE_RECEIVE) and (x <= MACH_MSG_TYPE_MOVE_SEND_ONCE)) {
    return (x >= MACH_MSG_TYPE_MOVE_RECEIVE) and (x <= MACH_MSG_TYPE_MOVE_SEND_ONCE);
}
pub const MACH_MSG_OPTION_NONE = @as(c_int, 0x00000000);
pub const MACH_SEND_MSG = @as(c_int, 0x00000001);
pub const MACH_RCV_MSG = @as(c_int, 0x00000002);
pub const MACH_RCV_LARGE = @as(c_int, 0x00000004);
pub const MACH_RCV_LARGE_IDENTITY = @as(c_int, 0x00000008);
pub const MACH_SEND_TIMEOUT = @as(c_int, 0x00000010);
pub const MACH_SEND_OVERRIDE = @as(c_int, 0x00000020);
pub const MACH_SEND_INTERRUPT = @as(c_int, 0x00000040);
pub const MACH_SEND_NOTIFY = @as(c_int, 0x00000080);
pub const MACH_SEND_ALWAYS = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x00010000, .hexadecimal);
pub const MACH_SEND_FILTER_NONFATAL = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x00010000, .hexadecimal);
pub const MACH_SEND_TRAILER = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x00020000, .hexadecimal);
pub const MACH_SEND_NOIMPORTANCE = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x00040000, .hexadecimal);
pub const MACH_SEND_NODENAP = MACH_SEND_NOIMPORTANCE;
pub const MACH_SEND_IMPORTANCE = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x00080000, .hexadecimal);
pub const MACH_SEND_SYNC_OVERRIDE = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x00100000, .hexadecimal);
pub const MACH_SEND_PROPAGATE_QOS = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x00200000, .hexadecimal);
pub const MACH_SEND_SYNC_USE_THRPRI = MACH_SEND_PROPAGATE_QOS;
pub const MACH_SEND_KERNEL = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x00400000, .hexadecimal);
pub const MACH_SEND_SYNC_BOOTSTRAP_CHECKIN = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x00800000, .hexadecimal);
pub const MACH_RCV_TIMEOUT = @as(c_int, 0x00000100);
pub const MACH_RCV_NOTIFY = @as(c_int, 0x00000000);
pub const MACH_RCV_INTERRUPT = @as(c_int, 0x00000400);
pub const MACH_RCV_VOUCHER = @as(c_int, 0x00000800);
pub const MACH_RCV_OVERWRITE = @as(c_int, 0x00000000);
pub const MACH_RCV_GUARDED_DESC = @as(c_int, 0x00001000);
pub const MACH_RCV_SYNC_WAIT = @as(c_int, 0x00004000);
pub const MACH_RCV_SYNC_PEEK = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x00008000, .hexadecimal);
pub const MACH_MSG_STRICT_REPLY = @as(c_int, 0x00000200);
pub const MACH_RCV_TRAILER_NULL = @as(c_int, 0);
pub const MACH_RCV_TRAILER_SEQNO = @as(c_int, 1);
pub const MACH_RCV_TRAILER_SENDER = @as(c_int, 2);
pub const MACH_RCV_TRAILER_AUDIT = @as(c_int, 3);
pub const MACH_RCV_TRAILER_CTX = @as(c_int, 4);
pub const MACH_RCV_TRAILER_AV = @as(c_int, 7);
pub const MACH_RCV_TRAILER_LABELS = @as(c_int, 8);
pub inline fn MACH_RCV_TRAILER_TYPE(x: anytype) @TypeOf((x & @as(c_int, 0xf)) << @as(c_int, 28)) {
    return (x & @as(c_int, 0xf)) << @as(c_int, 28);
}
pub inline fn MACH_RCV_TRAILER_ELEMENTS(x: anytype) @TypeOf((x & @as(c_int, 0xf)) << @as(c_int, 24)) {
    return (x & @as(c_int, 0xf)) << @as(c_int, 24);
}
pub const MACH_RCV_TRAILER_MASK = @as(c_int, 0xf) << @as(c_int, 24);
pub inline fn GET_RCV_ELEMENTS(y: anytype) @TypeOf((y >> @as(c_int, 24)) & @as(c_int, 0xf)) {
    return (y >> @as(c_int, 24)) & @as(c_int, 0xf);
}
pub inline fn REQUESTED_TRAILER_SIZE_NATIVE(y: anytype) mach_msg_trailer_size_t {
    return @import("std").zig.c_translation.cast(mach_msg_trailer_size_t, if (GET_RCV_ELEMENTS(y) == MACH_RCV_TRAILER_NULL) @import("std").zig.c_translation.sizeof(mach_msg_trailer_t) else if (GET_RCV_ELEMENTS(y) == MACH_RCV_TRAILER_SEQNO) @import("std").zig.c_translation.sizeof(mach_msg_seqno_trailer_t) else if (GET_RCV_ELEMENTS(y) == MACH_RCV_TRAILER_SENDER) @import("std").zig.c_translation.sizeof(mach_msg_security_trailer_t) else if (GET_RCV_ELEMENTS(y) == MACH_RCV_TRAILER_AUDIT) @import("std").zig.c_translation.sizeof(mach_msg_audit_trailer_t) else if (GET_RCV_ELEMENTS(y) == MACH_RCV_TRAILER_CTX) @import("std").zig.c_translation.sizeof(mach_msg_context_trailer_t) else if (GET_RCV_ELEMENTS(y) == MACH_RCV_TRAILER_AV) @import("std").zig.c_translation.sizeof(mach_msg_mac_trailer_t) else @import("std").zig.c_translation.sizeof(mach_msg_max_trailer_t));
}
pub inline fn REQUESTED_TRAILER_SIZE(y: anytype) @TypeOf(REQUESTED_TRAILER_SIZE_NATIVE(y)) {
    return REQUESTED_TRAILER_SIZE_NATIVE(y);
}
pub const MACH_MSG_SUCCESS = @as(c_int, 0x00000000);
pub const MACH_MSG_MASK = @as(c_int, 0x00003e00);
pub const MACH_MSG_IPC_SPACE = @as(c_int, 0x00002000);
pub const MACH_MSG_VM_SPACE = @as(c_int, 0x00001000);
pub const MACH_MSG_IPC_KERNEL = @as(c_int, 0x00000800);
pub const MACH_MSG_VM_KERNEL = @as(c_int, 0x00000400);
pub const MACH_SEND_IN_PROGRESS = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x10000001, .hexadecimal);
pub const MACH_SEND_INVALID_DATA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x10000002, .hexadecimal);
pub const MACH_SEND_INVALID_DEST = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x10000003, .hexadecimal);
pub const MACH_SEND_TIMED_OUT = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x10000004, .hexadecimal);
pub const MACH_SEND_INVALID_VOUCHER = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x10000005, .hexadecimal);
pub const MACH_SEND_INTERRUPTED = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x10000007, .hexadecimal);
pub const MACH_SEND_MSG_TOO_SMALL = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x10000008, .hexadecimal);
pub const MACH_SEND_INVALID_REPLY = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x10000009, .hexadecimal);
pub const MACH_SEND_INVALID_RIGHT = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x1000000a, .hexadecimal);
pub const MACH_SEND_INVALID_NOTIFY = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x1000000b, .hexadecimal);
pub const MACH_SEND_INVALID_MEMORY = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x1000000c, .hexadecimal);
pub const MACH_SEND_NO_BUFFER = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x1000000d, .hexadecimal);
pub const MACH_SEND_TOO_LARGE = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x1000000e, .hexadecimal);
pub const MACH_SEND_INVALID_TYPE = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x1000000f, .hexadecimal);
pub const MACH_SEND_INVALID_HEADER = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x10000010, .hexadecimal);
pub const MACH_SEND_INVALID_TRAILER = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x10000011, .hexadecimal);
pub const MACH_SEND_INVALID_CONTEXT = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x10000012, .hexadecimal);
pub const MACH_SEND_INVALID_RT_OOL_SIZE = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x10000015, .hexadecimal);
pub const MACH_SEND_NO_GRANT_DEST = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x10000016, .hexadecimal);
pub const MACH_SEND_MSG_FILTERED = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x10000017, .hexadecimal);
pub const MACH_RCV_IN_PROGRESS = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x10004001, .hexadecimal);
pub const MACH_RCV_INVALID_NAME = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x10004002, .hexadecimal);
pub const MACH_RCV_TIMED_OUT = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x10004003, .hexadecimal);
pub const MACH_RCV_TOO_LARGE = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x10004004, .hexadecimal);
pub const MACH_RCV_INTERRUPTED = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x10004005, .hexadecimal);
pub const MACH_RCV_PORT_CHANGED = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x10004006, .hexadecimal);
pub const MACH_RCV_INVALID_NOTIFY = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x10004007, .hexadecimal);
pub const MACH_RCV_INVALID_DATA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x10004008, .hexadecimal);
pub const MACH_RCV_PORT_DIED = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x10004009, .hexadecimal);
pub const MACH_RCV_IN_SET = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x1000400a, .hexadecimal);
pub const MACH_RCV_HEADER_ERROR = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x1000400b, .hexadecimal);
pub const MACH_RCV_BODY_ERROR = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x1000400c, .hexadecimal);
pub const MACH_RCV_INVALID_TYPE = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x1000400d, .hexadecimal);
pub const MACH_RCV_SCATTER_SMALL = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x1000400e, .hexadecimal);
pub const MACH_RCV_INVALID_TRAILER = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x1000400f, .hexadecimal);
pub const MACH_RCV_IN_PROGRESS_TIMED = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x10004011, .hexadecimal);
pub const MACH_RCV_INVALID_REPLY = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x10004012, .hexadecimal);
pub const _MACH_VM_STATISTICS_H_ = "";
pub const VM_PAGE_QUERY_PAGE_PRESENT = @as(c_int, 0x1);
pub const VM_PAGE_QUERY_PAGE_FICTITIOUS = @as(c_int, 0x2);
pub const VM_PAGE_QUERY_PAGE_REF = @as(c_int, 0x4);
pub const VM_PAGE_QUERY_PAGE_DIRTY = @as(c_int, 0x8);
pub const VM_PAGE_QUERY_PAGE_PAGED_OUT = @as(c_int, 0x10);
pub const VM_PAGE_QUERY_PAGE_COPIED = @as(c_int, 0x20);
pub const VM_PAGE_QUERY_PAGE_SPECULATIVE = @as(c_int, 0x40);
pub const VM_PAGE_QUERY_PAGE_EXTERNAL = @as(c_int, 0x80);
pub const VM_PAGE_QUERY_PAGE_CS_VALIDATED = @as(c_int, 0x100);
pub const VM_PAGE_QUERY_PAGE_CS_TAINTED = @as(c_int, 0x200);
pub const VM_PAGE_QUERY_PAGE_CS_NX = @as(c_int, 0x400);
pub const VM_PAGE_QUERY_PAGE_REUSABLE = @as(c_int, 0x800);
pub const VM_FLAGS_FIXED = @as(c_int, 0x0000);
pub const VM_FLAGS_ANYWHERE = @as(c_int, 0x0001);
pub const VM_FLAGS_PURGABLE = @as(c_int, 0x0002);
pub const VM_FLAGS_4GB_CHUNK = @as(c_int, 0x0004);
pub const VM_FLAGS_RANDOM_ADDR = @as(c_int, 0x0008);
pub const VM_FLAGS_NO_CACHE = @as(c_int, 0x0010);
pub const VM_FLAGS_RESILIENT_CODESIGN = @as(c_int, 0x0020);
pub const VM_FLAGS_RESILIENT_MEDIA = @as(c_int, 0x0040);
pub const VM_FLAGS_PERMANENT = @as(c_int, 0x0080);
pub const VM_FLAGS_OVERWRITE = @as(c_int, 0x4000);
pub const VM_FLAGS_SUPERPAGE_MASK = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x70000, .hexadecimal);
pub const VM_FLAGS_RETURN_DATA_ADDR = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x100000, .hexadecimal);
pub const VM_FLAGS_RETURN_4K_DATA_ADDR = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x800000, .hexadecimal);
pub const VM_FLAGS_ALIAS_MASK = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0xFF000000, .hexadecimal);
pub const VM_FLAGS_USER_ALLOCATE = ((((((((VM_FLAGS_FIXED | VM_FLAGS_ANYWHERE) | VM_FLAGS_PURGABLE) | VM_FLAGS_4GB_CHUNK) | VM_FLAGS_RANDOM_ADDR) | VM_FLAGS_NO_CACHE) | VM_FLAGS_PERMANENT) | VM_FLAGS_OVERWRITE) | VM_FLAGS_SUPERPAGE_MASK) | VM_FLAGS_ALIAS_MASK;
pub const VM_FLAGS_USER_MAP = (VM_FLAGS_USER_ALLOCATE | VM_FLAGS_RETURN_4K_DATA_ADDR) | VM_FLAGS_RETURN_DATA_ADDR;
pub const VM_FLAGS_USER_REMAP = (((((VM_FLAGS_FIXED | VM_FLAGS_ANYWHERE) | VM_FLAGS_RANDOM_ADDR) | VM_FLAGS_OVERWRITE) | VM_FLAGS_RETURN_DATA_ADDR) | VM_FLAGS_RESILIENT_CODESIGN) | VM_FLAGS_RESILIENT_MEDIA;
pub const VM_FLAGS_SUPERPAGE_SHIFT = @as(c_int, 16);
pub const SUPERPAGE_NONE = @as(c_int, 0);
pub const SUPERPAGE_SIZE_ANY = @as(c_int, 1);
pub const VM_FLAGS_SUPERPAGE_NONE = SUPERPAGE_NONE << VM_FLAGS_SUPERPAGE_SHIFT;
pub const VM_FLAGS_SUPERPAGE_SIZE_ANY = SUPERPAGE_SIZE_ANY << VM_FLAGS_SUPERPAGE_SHIFT;
pub const SUPERPAGE_SIZE_2MB = @as(c_int, 2);
pub const VM_FLAGS_SUPERPAGE_SIZE_2MB = SUPERPAGE_SIZE_2MB << VM_FLAGS_SUPERPAGE_SHIFT;
pub const GUARD_TYPE_VIRT_MEMORY = @as(c_int, 0x5);
pub const __VM_LEDGER_ACCOUNTING_POSTMARK = @import("std").zig.c_translation.promoteIntLiteral(c_int, 2019032600, .decimal);
pub const VM_LEDGER_TAG_NONE = @as(c_int, 0x00000000);
pub const VM_LEDGER_TAG_DEFAULT = @as(c_int, 0x00000001);
pub const VM_LEDGER_TAG_NETWORK = @as(c_int, 0x00000002);
pub const VM_LEDGER_TAG_MEDIA = @as(c_int, 0x00000003);
pub const VM_LEDGER_TAG_GRAPHICS = @as(c_int, 0x00000004);
pub const VM_LEDGER_TAG_NEURAL = @as(c_int, 0x00000005);
pub const VM_LEDGER_TAG_MAX = @as(c_int, 0x00000005);
pub const VM_LEDGER_FLAG_NO_FOOTPRINT = @as(c_int, 1) << @as(c_int, 0);
pub const VM_LEDGER_FLAG_NO_FOOTPRINT_FOR_DEBUG = @as(c_int, 1) << @as(c_int, 1);
pub const VM_LEDGER_FLAGS = VM_LEDGER_FLAG_NO_FOOTPRINT | VM_LEDGER_FLAG_NO_FOOTPRINT_FOR_DEBUG;
pub const VM_MEMORY_MALLOC = @as(c_int, 1);
pub const VM_MEMORY_MALLOC_SMALL = @as(c_int, 2);
pub const VM_MEMORY_MALLOC_LARGE = @as(c_int, 3);
pub const VM_MEMORY_MALLOC_HUGE = @as(c_int, 4);
pub const VM_MEMORY_SBRK = @as(c_int, 5);
pub const VM_MEMORY_REALLOC = @as(c_int, 6);
pub const VM_MEMORY_MALLOC_TINY = @as(c_int, 7);
pub const VM_MEMORY_MALLOC_LARGE_REUSABLE = @as(c_int, 8);
pub const VM_MEMORY_MALLOC_LARGE_REUSED = @as(c_int, 9);
pub const VM_MEMORY_ANALYSIS_TOOL = @as(c_int, 10);
pub const VM_MEMORY_MALLOC_NANO = @as(c_int, 11);
pub const VM_MEMORY_MALLOC_MEDIUM = @as(c_int, 12);
pub const VM_MEMORY_MALLOC_PGUARD = @as(c_int, 13);
pub const VM_MEMORY_MALLOC_PROB_GUARD = @as(c_int, 13);
pub const VM_MEMORY_MACH_MSG = @as(c_int, 20);
pub const VM_MEMORY_IOKIT = @as(c_int, 21);
pub const VM_MEMORY_STACK = @as(c_int, 30);
pub const VM_MEMORY_GUARD = @as(c_int, 31);
pub const VM_MEMORY_SHARED_PMAP = @as(c_int, 32);
pub const VM_MEMORY_DYLIB = @as(c_int, 33);
pub const VM_MEMORY_OBJC_DISPATCHERS = @as(c_int, 34);
pub const VM_MEMORY_UNSHARED_PMAP = @as(c_int, 35);
pub const VM_MEMORY_APPKIT = @as(c_int, 40);
pub const VM_MEMORY_FOUNDATION = @as(c_int, 41);
pub const VM_MEMORY_COREGRAPHICS = @as(c_int, 42);
pub const VM_MEMORY_CORESERVICES = @as(c_int, 43);
pub const VM_MEMORY_CARBON = VM_MEMORY_CORESERVICES;
pub const VM_MEMORY_JAVA = @as(c_int, 44);
pub const VM_MEMORY_COREDATA = @as(c_int, 45);
pub const VM_MEMORY_COREDATA_OBJECTIDS = @as(c_int, 46);
pub const VM_MEMORY_ATS = @as(c_int, 50);
pub const VM_MEMORY_LAYERKIT = @as(c_int, 51);
pub const VM_MEMORY_CGIMAGE = @as(c_int, 52);
pub const VM_MEMORY_TCMALLOC = @as(c_int, 53);
pub const VM_MEMORY_COREGRAPHICS_DATA = @as(c_int, 54);
pub const VM_MEMORY_COREGRAPHICS_SHARED = @as(c_int, 55);
pub const VM_MEMORY_COREGRAPHICS_FRAMEBUFFERS = @as(c_int, 56);
pub const VM_MEMORY_COREGRAPHICS_BACKINGSTORES = @as(c_int, 57);
pub const VM_MEMORY_COREGRAPHICS_XALLOC = @as(c_int, 58);
pub const VM_MEMORY_COREGRAPHICS_MISC = VM_MEMORY_COREGRAPHICS;
pub const VM_MEMORY_DYLD = @as(c_int, 60);
pub const VM_MEMORY_DYLD_MALLOC = @as(c_int, 61);
pub const VM_MEMORY_SQLITE = @as(c_int, 62);
pub const VM_MEMORY_JAVASCRIPT_CORE = @as(c_int, 63);
pub const VM_MEMORY_WEBASSEMBLY = VM_MEMORY_JAVASCRIPT_CORE;
pub const VM_MEMORY_JAVASCRIPT_JIT_EXECUTABLE_ALLOCATOR = @as(c_int, 64);
pub const VM_MEMORY_JAVASCRIPT_JIT_REGISTER_FILE = @as(c_int, 65);
pub const VM_MEMORY_GLSL = @as(c_int, 66);
pub const VM_MEMORY_OPENCL = @as(c_int, 67);
pub const VM_MEMORY_COREIMAGE = @as(c_int, 68);
pub const VM_MEMORY_WEBCORE_PURGEABLE_BUFFERS = @as(c_int, 69);
pub const VM_MEMORY_IMAGEIO = @as(c_int, 70);
pub const VM_MEMORY_COREPROFILE = @as(c_int, 71);
pub const VM_MEMORY_ASSETSD = @as(c_int, 72);
pub const VM_MEMORY_OS_ALLOC_ONCE = @as(c_int, 73);
pub const VM_MEMORY_LIBDISPATCH = @as(c_int, 74);
pub const VM_MEMORY_ACCELERATE = @as(c_int, 75);
pub const VM_MEMORY_COREUI = @as(c_int, 76);
pub const VM_MEMORY_COREUIFILE = @as(c_int, 77);
pub const VM_MEMORY_GENEALOGY = @as(c_int, 78);
pub const VM_MEMORY_RAWCAMERA = @as(c_int, 79);
pub const VM_MEMORY_CORPSEINFO = @as(c_int, 80);
pub const VM_MEMORY_ASL = @as(c_int, 81);
pub const VM_MEMORY_SWIFT_RUNTIME = @as(c_int, 82);
pub const VM_MEMORY_SWIFT_METADATA = @as(c_int, 83);
pub const VM_MEMORY_DHMM = @as(c_int, 84);
pub const VM_MEMORY_SCENEKIT = @as(c_int, 86);
pub const VM_MEMORY_SKYWALK = @as(c_int, 87);
pub const VM_MEMORY_IOSURFACE = @as(c_int, 88);
pub const VM_MEMORY_LIBNETWORK = @as(c_int, 89);
pub const VM_MEMORY_AUDIO = @as(c_int, 90);
pub const VM_MEMORY_VIDEOBITSTREAM = @as(c_int, 91);
pub const VM_MEMORY_CM_XPC = @as(c_int, 92);
pub const VM_MEMORY_CM_RPC = @as(c_int, 93);
pub const VM_MEMORY_CM_MEMORYPOOL = @as(c_int, 94);
pub const VM_MEMORY_CM_READCACHE = @as(c_int, 95);
pub const VM_MEMORY_CM_CRABS = @as(c_int, 96);
pub const VM_MEMORY_QUICKLOOK_THUMBNAILS = @as(c_int, 97);
pub const VM_MEMORY_ACCOUNTS = @as(c_int, 98);
pub const VM_MEMORY_SANITIZER = @as(c_int, 99);
pub const VM_MEMORY_IOACCELERATOR = @as(c_int, 100);
pub const VM_MEMORY_CM_REGWARP = @as(c_int, 101);
pub const VM_MEMORY_EAR_DECODER = @as(c_int, 102);
pub const VM_MEMORY_COREUI_CACHED_IMAGE_DATA = @as(c_int, 103);
pub const VM_MEMORY_COLORSYNC = @as(c_int, 104);
pub const VM_MEMORY_ROSETTA = @as(c_int, 230);
pub const VM_MEMORY_ROSETTA_THREAD_CONTEXT = @as(c_int, 231);
pub const VM_MEMORY_ROSETTA_INDIRECT_BRANCH_MAP = @as(c_int, 232);
pub const VM_MEMORY_ROSETTA_RETURN_STACK = @as(c_int, 233);
pub const VM_MEMORY_ROSETTA_EXECUTABLE_HEAP = @as(c_int, 234);
pub const VM_MEMORY_ROSETTA_USER_LDT = @as(c_int, 235);
pub const VM_MEMORY_ROSETTA_ARENA = @as(c_int, 236);
pub const VM_MEMORY_ROSETTA_10 = @as(c_int, 239);
pub const VM_MEMORY_APPLICATION_SPECIFIC_1 = @as(c_int, 240);
pub const VM_MEMORY_APPLICATION_SPECIFIC_16 = @as(c_int, 255);
pub inline fn VM_MAKE_TAG(tag: anytype) @TypeOf(tag << @as(c_int, 24)) {
    return tag << @as(c_int, 24);
}
pub const _MACH_MACHINE_H_ = "";
pub const __darwin_pthread_handler_rec = struct___darwin_pthread_handler_rec;
pub const _opaque_pthread_attr_t = struct__opaque_pthread_attr_t;
pub const _opaque_pthread_cond_t = struct__opaque_pthread_cond_t;
pub const _opaque_pthread_condattr_t = struct__opaque_pthread_condattr_t;
pub const _opaque_pthread_mutex_t = struct__opaque_pthread_mutex_t;
pub const _opaque_pthread_mutexattr_t = struct__opaque_pthread_mutexattr_t;
pub const _opaque_pthread_once_t = struct__opaque_pthread_once_t;
pub const _opaque_pthread_rwlock_t = struct__opaque_pthread_rwlock_t;
pub const _opaque_pthread_rwlockattr_t = struct__opaque_pthread_rwlockattr_t;
pub const _opaque_pthread_t = struct__opaque_pthread_t;
pub const mach_port_status = struct_mach_port_status;
pub const mach_port_limits = struct_mach_port_limits;
pub const mach_port_info_ext = struct_mach_port_info_ext;
pub const mach_port_guard_info = struct_mach_port_guard_info;
pub const mach_port_qos = struct_mach_port_qos;
pub const mach_service_port_info = struct_mach_service_port_info;
pub const mach_port_options = struct_mach_port_options;
pub const mach_port_guard_exception_codes = enum_mach_port_guard_exception_codes;
pub const vm_statistics = struct_vm_statistics;
pub const vm_statistics64 = struct_vm_statistics64;
pub const vm_extmod_statistics = struct_vm_extmod_statistics;
pub const vm_purgeable_stat = struct_vm_purgeable_stat;
pub const vm_purgeable_info = struct_vm_purgeable_info;
pub const virtual_memory_guard_exception_codes = enum_virtual_memory_guard_exception_codes;
pub const time_value = struct_time_value;
pub const host_can_has_debugger_info = struct_host_can_has_debugger_info;
pub const host_basic_info = struct_host_basic_info;
pub const host_sched_info = struct_host_sched_info;
pub const kernel_resource_sizes = struct_kernel_resource_sizes;
pub const host_priority_info = struct_host_priority_info;
pub const host_load_info = struct_host_load_info;
pub const host_cpu_load_info = struct_host_cpu_load_info;
pub const host_preferred_user_arch = struct_host_preferred_user_arch;
pub const memory_object_perf_info = struct_memory_object_perf_info;
pub const memory_object_attr_info = struct_memory_object_attr_info;
pub const memory_object_behave_info = struct_memory_object_behave_info;
pub const arm_state_hdr = struct_arm_state_hdr;
pub const arm_unified_thread_state = struct_arm_unified_thread_state;
pub const ipc_info_space = struct_ipc_info_space;
pub const ipc_info_space_basic = struct_ipc_info_space_basic;
pub const ipc_info_name = struct_ipc_info_name;
pub const ipc_info_tree_name = struct_ipc_info_tree_name;
pub const ipc_info_port = struct_ipc_info_port;
pub const mach_voucher_attr_recipe_data = struct_mach_voucher_attr_recipe_data;
pub const processor_cpu_stat = struct_processor_cpu_stat;
pub const processor_cpu_stat64 = struct_processor_cpu_stat64;
pub const processor_basic_info = struct_processor_basic_info;
pub const processor_cpu_load_info = struct_processor_cpu_load_info;
pub const processor_set_basic_info = struct_processor_set_basic_info;
pub const processor_set_load_info = struct_processor_set_load_info;
pub const policy_timeshare_base = struct_policy_timeshare_base;
pub const policy_timeshare_limit = struct_policy_timeshare_limit;
pub const policy_timeshare_info = struct_policy_timeshare_info;
pub const policy_rr_base = struct_policy_rr_base;
pub const policy_rr_limit = struct_policy_rr_limit;
pub const policy_rr_info = struct_policy_rr_info;
pub const policy_fifo_base = struct_policy_fifo_base;
pub const policy_fifo_limit = struct_policy_fifo_limit;
pub const policy_fifo_info = struct_policy_fifo_info;
pub const policy_bases = struct_policy_bases;
pub const policy_limits = struct_policy_limits;
pub const policy_infos = struct_policy_infos;
pub const task_basic_info_32 = struct_task_basic_info_32;
pub const task_basic_info_64 = struct_task_basic_info_64;
pub const task_basic_info = struct_task_basic_info;
pub const task_events_info = struct_task_events_info;
pub const task_thread_times_info = struct_task_thread_times_info;
pub const task_absolutetime_info = struct_task_absolutetime_info;
pub const task_kernelmemory_info = struct_task_kernelmemory_info;
pub const task_affinity_tag_info = struct_task_affinity_tag_info;
pub const task_dyld_info = struct_task_dyld_info;
pub const task_basic_info_64_2 = struct_task_basic_info_64_2;
pub const task_extmod_info = struct_task_extmod_info;
pub const mach_task_basic_info = struct_mach_task_basic_info;
pub const task_power_info = struct_task_power_info;
pub const task_vm_info = struct_task_vm_info;
pub const task_trace_memory_info = struct_task_trace_memory_info;
pub const task_wait_state_info = struct_task_wait_state_info;
pub const task_power_info_v2 = struct_task_power_info_v2;
pub const task_flags_info = struct_task_flags_info;
pub const task_inspect_flavor = enum_task_inspect_flavor;
pub const task_inspect_basic_counts = struct_task_inspect_basic_counts;
pub const task_role = enum_task_role;
pub const task_category_policy = struct_task_category_policy;
pub const task_latency_qos = enum_task_latency_qos;
pub const task_throughput_qos = enum_task_throughput_qos;
pub const task_qos_policy = struct_task_qos_policy;
pub const thread_basic_info = struct_thread_basic_info;
pub const thread_identifier_info = struct_thread_identifier_info;
pub const thread_extended_info = struct_thread_extended_info;
pub const io_stat_entry = struct_io_stat_entry;
pub const io_stat_info = struct_io_stat_info;
pub const thread_standard_policy = struct_thread_standard_policy;
pub const thread_extended_policy = struct_thread_extended_policy;
pub const thread_time_constraint_policy = struct_thread_time_constraint_policy;
pub const thread_precedence_policy = struct_thread_precedence_policy;
pub const thread_affinity_policy = struct_thread_affinity_policy;
pub const thread_background_policy = struct_thread_background_policy;
pub const thread_latency_qos_policy = struct_thread_latency_qos_policy;
pub const thread_throughput_qos_policy = struct_thread_throughput_qos_policy;
pub const _OSUnalignedU16 = struct__OSUnalignedU16;
pub const _OSUnalignedU32 = struct__OSUnalignedU32;
pub const _OSUnalignedU64 = struct__OSUnalignedU64;
pub const routine_descriptor = struct_routine_descriptor;
pub const mig_subsystem = struct_mig_subsystem;
pub const mig_symtab = struct_mig_symtab;
pub const __RequestUnion__clock_priv_subsystem = union___RequestUnion__clock_priv_subsystem;
pub const __ReplyUnion__clock_priv_subsystem = union___ReplyUnion__clock_priv_subsystem;
pub const zone_info = struct_zone_info;
pub const mach_zone_name = struct_mach_zone_name;
pub const mach_zone_info_data = struct_mach_zone_info_data;
pub const task_zone_info_data = struct_task_zone_info_data;
pub const zone_btrecord = struct_zone_btrecord;
pub const hash_info_bucket = struct_hash_info_bucket;
pub const lockgroup_info = struct_lockgroup_info;
pub const mach_core_details = struct_mach_core_details;
pub const mach_core_fileheader = struct_mach_core_fileheader;
pub const mach_core_details_v2 = struct_mach_core_details_v2;
pub const mach_core_fileheader_base = struct_mach_core_fileheader_base;
pub const mach_core_fileheader_v2 = struct_mach_core_fileheader_v2;
pub const rpc_routine_arg_descriptor = struct_rpc_routine_arg_descriptor;
pub const rpc_routine_descriptor = struct_rpc_routine_descriptor;
pub const rpc_signature = struct_rpc_signature;
pub const rpc_subsystem = struct_rpc_subsystem;
pub const voucher_mach_msg_state_s = struct_voucher_mach_msg_state_s;
pub const mach_port = mach_port_t;
