// Written by misctools/portable/bindings/imports.ts from the bindings of bun. Do not edit.
//
// The functions of libuv that the portable image can call. libuv has no DLL: it is linked into the
// Windows host (host_win.c, BUN_HOST_LIBUV), and the host answers the library "libuv" of the image's
// import table from this table. Every function is named here, so the linker takes it from libuv, and
// a function that this libuv does not have is an error of the link of the host.
//
// The declarations do not give the types of the functions: the host only takes their addresses.
#include <string.h>

#define BUN_HOST_UV_SYMBOLS(UV) \
  UV(uv__winsock_ensure) \
  UV(uv_accept) \
  UV(uv_async_init) \
  UV(uv_async_send) \
  UV(uv_buf_init) \
  UV(uv_cancel) \
  UV(uv_check_init) \
  UV(uv_check_start) \
  UV(uv_check_stop) \
  UV(uv_close) \
  UV(uv_cpu_info) \
  UV(uv_cwd) \
  UV(uv_default_loop) \
  UV(uv_disable_stdio_inheritance) \
  UV(uv_fileno) \
  UV(uv_free_cpu_info) \
  UV(uv_free_interface_addresses) \
  UV(uv_freeaddrinfo) \
  UV(uv_fs_chmod) \
  UV(uv_fs_chown) \
  UV(uv_fs_close) \
  UV(uv_fs_copyfile) \
  UV(uv_fs_event_init) \
  UV(uv_fs_event_start) \
  UV(uv_fs_event_stop) \
  UV(uv_fs_fchmod) \
  UV(uv_fs_fchown) \
  UV(uv_fs_fdatasync) \
  UV(uv_fs_fstat) \
  UV(uv_fs_fsync) \
  UV(uv_fs_ftruncate) \
  UV(uv_fs_futime) \
  UV(uv_fs_lchown) \
  UV(uv_fs_link) \
  UV(uv_fs_lstat) \
  UV(uv_fs_lutime) \
  UV(uv_fs_mkdir) \
  UV(uv_fs_mkdtemp) \
  UV(uv_fs_open) \
  UV(uv_fs_read) \
  UV(uv_fs_readlink) \
  UV(uv_fs_realpath) \
  UV(uv_fs_rename) \
  UV(uv_fs_req_cleanup) \
  UV(uv_fs_rmdir) \
  UV(uv_fs_stat) \
  UV(uv_fs_statfs) \
  UV(uv_fs_symlink) \
  UV(uv_fs_unlink) \
  UV(uv_fs_utime) \
  UV(uv_fs_write) \
  UV(uv_get_osfhandle) \
  UV(uv_get_total_memory) \
  UV(uv_getaddrinfo) \
  UV(uv_getrusage) \
  UV(uv_guess_handle) \
  UV(uv_handle_get_data) \
  UV(uv_handle_get_loop) \
  UV(uv_handle_get_type) \
  UV(uv_handle_set_data) \
  UV(uv_handle_size) \
  UV(uv_handle_type_name) \
  UV(uv_has_ref) \
  UV(uv_idle_init) \
  UV(uv_idle_start) \
  UV(uv_idle_stop) \
  UV(uv_interface_addresses) \
  UV(uv_is_active) \
  UV(uv_is_closing) \
  UV(uv_is_readable) \
  UV(uv_is_writable) \
  UV(uv_listen) \
  UV(uv_loop_alive) \
  UV(uv_loop_close) \
  UV(uv_loop_delete) \
  UV(uv_loop_init) \
  UV(uv_loop_new) \
  UV(uv_now) \
  UV(uv_open_osfhandle) \
  UV(uv_os_getppid) \
  UV(uv_os_getpriority) \
  UV(uv_os_homedir) \
  UV(uv_os_uname) \
  UV(uv_pipe) \
  UV(uv_pipe_bind2) \
  UV(uv_pipe_connect2) \
  UV(uv_pipe_init) \
  UV(uv_pipe_open) \
  UV(uv_poll_init_socket) \
  UV(uv_poll_start) \
  UV(uv_poll_stop) \
  UV(uv_prepare_init) \
  UV(uv_prepare_start) \
  UV(uv_prepare_stop) \
  UV(uv_process_kill) \
  UV(uv_read_start) \
  UV(uv_read_stop) \
  UV(uv_ref) \
  UV(uv_replace_allocator) \
  UV(uv_run) \
  UV(uv_signal_init) \
  UV(uv_signal_start) \
  UV(uv_signal_stop) \
  UV(uv_spawn) \
  UV(uv_stop) \
  UV(uv_stream_get_write_queue_size) \
  UV(uv_stream_set_blocking) \
  UV(uv_timer_get_due_in) \
  UV(uv_timer_init) \
  UV(uv_timer_start) \
  UV(uv_timer_stop) \
  UV(uv_translate_sys_error) \
  UV(uv_try_write) \
  UV(uv_tty_init) \
  UV(uv_tty_set_mode) \
  UV(uv_unref) \
  UV(uv_update_time) \
  UV(uv_uptime) \
  UV(uv_walk) \
  UV(uv_write)

#define UV(name) void name(void);
BUN_HOST_UV_SYMBOLS(UV)
#undef UV

static const struct {
  const char *name;
  void (*address)(void);
} symbols[] = {
#define UV(name) {#name, name},
  BUN_HOST_UV_SYMBOLS(UV)
#undef UV
};

void *bun_host_uv_lookup(const char *symbol) {
  for (size_t i = 0; i < sizeof symbols / sizeof *symbols; i++)
    if (!strcmp(symbol, symbols[i].name)) return (void *)symbols[i].address;
  return 0;
}
